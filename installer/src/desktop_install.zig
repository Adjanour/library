const std = @import("std");
const download = @import("download.zig");
const manifest = @import("manifest.zig");
const planner = @import("planner.zig");
const platform = @import("platform.zig");

pub const Options = struct {
    root: []const u8,
    ca_cert_path: ?[]const u8 = null,
    allow_insecure_http: bool = false,
    environ_map: ?*const std.process.Environ.Map = null,
    create_shortcuts: bool = true,
};

pub const Result = struct {
    launcher_path: []u8,
    shortcut_path: ?[]u8 = null,

    pub fn deinit(self: Result, allocator: std.mem.Allocator) void {
        allocator.free(self.launcher_path);
        if (self.shortcut_path) |path| allocator.free(path);
    }
};

pub fn install(
    io: std.Io,
    allocator: std.mem.Allocator,
    release: *const manifest.Manifest,
    target: platform.Target,
    options: Options,
) !Result {
    if (!std.fs.path.isAbsolute(options.root)) return error.InstallRootMustBeAbsolute;

    const app = try planner.findPackageArtifact(release, .library_desktop, target);
    try validateVersion(app.package.version);
    try validateArtifact(target, app.artifact.kind);

    try std.Io.Dir.cwd().createDirPath(io, options.root);
    var root = try std.Io.Dir.openDirAbsolute(io, options.root, .{});
    defer root.close(io);
    try root.createDirPath(io, "desktop/versions");

    const version_path = try std.fmt.allocPrint(allocator, "desktop/versions/{s}", .{app.package.version});
    defer allocator.free(version_path);
    const cache_dir = try std.fmt.allocPrint(allocator, "{s}/cache", .{options.root});
    defer allocator.free(cache_dir);

    if (!directoryExists(io, root, version_path)) {
        const staging_relative = "desktop/.staging";
        if (directoryExists(io, root, staging_relative)) return error.InstallInProgress;
        try root.createDirPath(io, staging_relative);
        errdefer root.deleteTree(io, staging_relative) catch {};

        const source = try download.acquire(io, allocator, app.artifact, cache_dir, .{
            .ca_cert_path = options.ca_cert_path,
            .allow_insecure_http = options.allow_insecure_http,
        });
        defer allocator.free(source);
        const staging_absolute = try std.fs.path.join(allocator, &.{ options.root, staging_relative });
        defer allocator.free(staging_absolute);
        try extractArtifact(io, allocator, source, staging_absolute, target, app.artifact.kind);
        try root.rename(staging_relative, root, version_path, io);
        try writeReceipt(io, root, version_path, app.package.version, app.artifact.sha256);
    }

    const current = readPointer(io, allocator, root, "desktop/current.txt") catch |err| switch (err) {
        error.FileNotFound => null,
        else => return err,
    };
    defer if (current) |value| allocator.free(value);
    if (current) |previous| {
        if (!std.mem.eql(u8, previous, app.package.version)) {
            try writePointer(io, root, "desktop/previous.txt", previous);
        }
    }
    try writePointer(io, root, "desktop/current.txt", app.package.version);

    var result = try writeLauncher(io, allocator, root, options.root, target);
    errdefer result.deinit(allocator);
    if (options.create_shortcuts) {
        result.shortcut_path = try createPlatformShortcut(io, allocator, options, result.launcher_path, app.package.version, target);
    }
    return result;
}

fn validateArtifact(target: platform.Target, kind: manifest.InstallKind) !void {
    switch (target.os) {
        .linux => if (kind != .tar_gz) return error.UnsupportedDesktopArtifact,
        .windows, .macos => if (kind != .portable_zip) return error.UnsupportedDesktopArtifact,
    }
}

fn extractArtifact(
    io: std.Io,
    allocator: std.mem.Allocator,
    source: []const u8,
    destination: []const u8,
    target: platform.Target,
    kind: manifest.InstallKind,
) !void {
    switch (kind) {
        .tar_gz => try extractTar(io, allocator, source, destination),
        .portable_zip => try extractZip(io, allocator, source, destination),
        else => return error.UnsupportedDesktopArtifact,
    }
    try makeExecutable(io, destination, target);
}

fn extractTar(io: std.Io, allocator: std.mem.Allocator, source: []const u8, destination: []const u8) !void {
    const result = try std.process.run(allocator, io, .{
        .argv = &.{ "tar", "-xzf", source, "-C", destination, "--no-same-owner", "--no-same-permissions" },
        .stdout_limit = .limited(64 * 1024),
        .stderr_limit = .limited(64 * 1024),
    });
    defer allocator.free(result.stdout);
    defer allocator.free(result.stderr);
    switch (result.term) {
        .exited => |code| if (code != 0) return error.ArchiveExtractionFailed,
        else => return error.ArchiveExtractionFailed,
    }
}

fn extractZip(io: std.Io, allocator: std.mem.Allocator, source: []const u8, destination: []const u8) !void {
    _ = allocator;
    var archive = try std.Io.Dir.openFileAbsolute(io, source, .{});
    defer archive.close(io);
    var read_buffer: [64 * 1024]u8 = undefined;
    var reader = archive.reader(io, &read_buffer);
    var destination_dir = try std.Io.Dir.openDirAbsolute(io, destination, .{});
    defer destination_dir.close(io);
    try std.zip.extract(destination_dir, &reader, .{});
}

fn makeExecutable(io: std.Io, destination: []const u8, target: platform.Target) !void {
    if (target.os != .linux) return;
    const relative = "app/app";
    const executable = try std.fs.path.join(std.heap.page_allocator, &.{ destination, relative });
    defer std.heap.page_allocator.free(executable);
    var file = try std.Io.Dir.openFileAbsolute(io, executable, .{ .mode = .read_write });
    defer file.close(io);
    try file.setPermissions(io, .executable_file);
}

fn writeLauncher(io: std.Io, allocator: std.mem.Allocator, root: std.Io.Dir, root_path: []const u8, target: platform.Target) !Result {
    try root.createDirPath(io, "desktop/bin");
    const relative_path = switch (target.os) {
        .windows => "desktop/bin/library.cmd",
        else => "desktop/bin/library",
    };
    var launcher = try root.createFileAtomic(io, relative_path, .{ .replace = true });
    defer launcher.deinit(io);
    if (target.os != .windows) try launcher.file.setPermissions(io, .executable_file);
    var buffer: [4096]u8 = undefined;
    var writer = launcher.file.writer(io, &buffer);
    switch (target.os) {
        .windows => try writer.interface.writeAll(
            "@echo off\r\n" ++
                "setlocal\r\n" ++
                "set \"ROOT=%~dp0..\\..\"\r\n" ++
                "set /p VERSION=<\"%ROOT%\\desktop\\current.txt\"\r\n" ++
                "set \"APP_ROOT=%ROOT%\\desktop\\versions\\%VERSION%\\Library\"\r\n" ++
                "cd /d \"%APP_ROOT%\"\r\n" ++
                "for /r \"%APP_ROOT%\" %%L in (*.bat) do (\r\n" ++
                "  call \"%%~fL\" %*\r\n" ++
                "  exit /b %%ERRORLEVEL%%\r\n" ++
                ")\r\n" ++
                "for /r \"%APP_ROOT%\" %%L in (*.cmd) do (\r\n" ++
                "  call \"%%~fL\" %*\r\n" ++
                "  exit /b %%ERRORLEVEL%%\r\n" ++
                ")\r\n" ++
                "for /r \"%APP_ROOT%\" %%L in (*.exe) do (\r\n" ++
                "  call \"%%~fL\" %*\r\n" ++
                "  exit /b %%ERRORLEVEL%%\r\n" ++
                ")\r\n" ++
                "echo Library desktop bundle is missing its launcher. 1>&2\r\n" ++
                "exit /b 1\r\n",
        ),
        .macos => try writer.interface.writeAll(
            "#!/bin/sh\n" ++
                "set -eu\n" ++
                "ROOT=$(CDPATH= cd -- \"$(dirname -- \"$0\")/../..\" && pwd)\n" ++
                "VERSION=$(cat \"$ROOT/desktop/current.txt\")\n" ++
                "APP_ROOT=\"$ROOT/desktop/versions/$VERSION/Library.app\"\n" ++
                "exec open \"$APP_ROOT\" --args \"$@\"\n",
        ),
        .linux => try writer.interface.writeAll(
            "#!/bin/sh\n" ++
                "set -eu\n" ++
                "ROOT=$(CDPATH= cd -- \"$(dirname -- \"$0\")/../..\" && pwd)\n" ++
                "VERSION=$(cat \"$ROOT/desktop/current.txt\")\n" ++
                "APP_ROOT=\"$ROOT/desktop/versions/$VERSION/app\"\n" ++
                "cd \"$APP_ROOT\"\n" ++
                "exec \"$APP_ROOT/app\" \"$@\"\n",
        ),
    }
    try writer.flush();
    try launcher.replace(io);
    return .{ .launcher_path = try std.fs.path.join(allocator, &.{ root_path, relative_path }) };
}

fn createPlatformShortcut(
    io: std.Io,
    allocator: std.mem.Allocator,
    options: Options,
    launcher_path: []const u8,
    app_version: []const u8,
    target: platform.Target,
) !?[]u8 {
    const environ = options.environ_map orelse return null;
    return switch (target.os) {
        .linux => try createLinuxShortcut(io, allocator, environ.*, launcher_path),
        .macos => try createMacShortcut(io, allocator, environ.*, launcher_path, app_version),
        .windows => null,
    };
}

fn createLinuxShortcut(io: std.Io, allocator: std.mem.Allocator, environ: std.process.Environ.Map, launcher_path: []const u8) ![]u8 {
    try validateShortcutPath(launcher_path);
    const data_home = if (environ.get("XDG_DATA_HOME")) |value|
        try allocator.dupe(u8, value)
    else
        try std.fs.path.join(allocator, &.{ environ.get("HOME") orelse return error.HomeDirectoryUnavailable, ".local", "share" });
    defer allocator.free(data_home);
    const applications_dir = try std.fs.path.join(allocator, &.{ data_home, "applications" });
    defer allocator.free(applications_dir);
    try std.Io.Dir.cwd().createDirPath(io, applications_dir);
    var directory = try std.Io.Dir.openDirAbsolute(io, applications_dir, .{});
    defer directory.close(io);
    var entry = try directory.createFileAtomic(io, "library.desktop", .{ .replace = true });
    defer entry.deinit(io);
    var buffer: [2048]u8 = undefined;
    var writer = entry.file.writer(io, &buffer);
    try writer.interface.print(
        "[Desktop Entry]\n" ++
            "Type=Application\n" ++
            "Name=Library\n" ++
            "Comment=Read local books and papers\n" ++
            "Exec=\"{s}\"\n" ++
            "Icon=accessories-ebook-reader\n" ++
            "Terminal=false\n" ++
            "Categories=Office;Viewer;\n" ++
            "StartupNotify=true\n",
        .{launcher_path},
    );
    try writer.flush();
    try entry.replace(io);
    return std.fs.path.join(allocator, &.{ applications_dir, "library.desktop" });
}

fn createMacShortcut(
    io: std.Io,
    allocator: std.mem.Allocator,
    environ: std.process.Environ.Map,
    launcher_path: []const u8,
    app_version: []const u8,
) ![]u8 {
    try validateShortcutPath(launcher_path);
    const home = environ.get("HOME") orelse return error.HomeDirectoryUnavailable;
    const app_path = try std.fs.path.join(allocator, &.{ home, "Applications", "Library.app" });
    errdefer allocator.free(app_path);
    const contents_path = try std.fs.path.join(allocator, &.{ app_path, "Contents" });
    defer allocator.free(contents_path);
    const executable_path = try std.fs.path.join(allocator, &.{ contents_path, "MacOS" });
    defer allocator.free(executable_path);
    try std.Io.Dir.cwd().createDirPath(io, executable_path);

    var contents = try std.Io.Dir.openDirAbsolute(io, contents_path, .{});
    defer contents.close(io);
    var plist = try contents.createFileAtomic(io, "Info.plist", .{ .replace = true });
    defer plist.deinit(io);
    var plist_buffer: [4096]u8 = undefined;
    var plist_writer = plist.file.writer(io, &plist_buffer);
    try plist_writer.interface.print(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n" ++
            "<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n" ++
            "<plist version=\"1.0\"><dict>\n" ++
            "<key>CFBundleExecutable</key><string>Library</string>\n" ++
            "<key>CFBundleIdentifier</key><string>com.bernard.library</string>\n" ++
            "<key>CFBundleName</key><string>Library</string>\n" ++
            "<key>CFBundlePackageType</key><string>APPL</string>\n" ++
            "<key>CFBundleShortVersionString</key><string>{s}</string>\n" ++
            "<key>LSMinimumSystemVersion</key><string>12.0</string>\n" ++
            "</dict></plist>\n",
        .{app_version},
    );
    try plist_writer.flush();
    try plist.replace(io);

    var executable_dir = try std.Io.Dir.openDirAbsolute(io, executable_path, .{});
    defer executable_dir.close(io);
    var launcher = try executable_dir.createFileAtomic(io, "Library", .{ .replace = true });
    defer launcher.deinit(io);
    try launcher.file.setPermissions(io, .executable_file);
    var launcher_buffer: [2048]u8 = undefined;
    var launcher_writer = launcher.file.writer(io, &launcher_buffer);
    try launcher_writer.interface.print("#!/bin/sh\nexec \"{s}\" \"$@\"\n", .{launcher_path});
    try launcher_writer.flush();
    try launcher.replace(io);
    return app_path;
}

fn validateShortcutPath(path: []const u8) !void {
    for (path) |char| {
        if (char == '"' or char == '\\' or char == '$' or char == '`' or char == '\n' or char == '\r') {
            return error.UnsafeShortcutPath;
        }
    }
}

fn writeReceipt(io: std.Io, root: std.Io.Dir, version_path: []const u8, version: []const u8, sha256: []const u8) !void {
    const receipt_path = try std.fmt.allocPrint(std.heap.page_allocator, "{s}/receipt.txt", .{version_path});
    defer std.heap.page_allocator.free(receipt_path);
    var receipt = try root.createFileAtomic(io, receipt_path, .{ .replace = true });
    defer receipt.deinit(io);
    var buffer: [512]u8 = undefined;
    var writer = receipt.file.writer(io, &buffer);
    try writer.interface.print("package=library_desktop\nversion={s}\nsha256={s}\n", .{ version, sha256 });
    try writer.flush();
    try receipt.replace(io);
}

fn directoryExists(io: std.Io, root: std.Io.Dir, path: []const u8) bool {
    var directory = root.openDir(io, path, .{}) catch return false;
    directory.close(io);
    return true;
}

fn validateVersion(version: []const u8) !void {
    if (version.len == 0) return error.InvalidVersion;
    for (version) |char| {
        if (!std.ascii.isAlphanumeric(char) and char != '.' and char != '-' and char != '_') return error.InvalidVersion;
    }
}

fn readPointer(io: std.Io, allocator: std.mem.Allocator, root: std.Io.Dir, path: []const u8) ![]u8 {
    const bytes = try root.readFileAlloc(io, path, allocator, .limited(256));
    const trimmed = std.mem.trim(u8, bytes, " \t\r\n");
    const result = try allocator.dupe(u8, trimmed);
    allocator.free(bytes);
    return result;
}

fn writePointer(io: std.Io, root: std.Io.Dir, path: []const u8, value: []const u8) !void {
    var file = try root.createFileAtomic(io, path, .{ .replace = true });
    defer file.deinit(io);
    var buffer: [256]u8 = undefined;
    var writer = file.file.writer(io, &buffer);
    try writer.interface.print("{s}\n", .{value});
    try writer.flush();
    try file.replace(io);
}

test "desktop launchers use the version pointer and native paths" {
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    const allocator = std.testing.allocator;
    const cwd = try std.process.currentPathAlloc(std.testing.io, allocator);
    defer allocator.free(cwd);
    const home = try std.fs.path.join(allocator, &.{ cwd, ".zig-cache", "tmp", tmp.sub_path[0..] });
    defer allocator.free(home);
    try std.Io.Dir.cwd().createDirPath(std.testing.io, home);
    var root = try std.Io.Dir.openDirAbsolute(std.testing.io, home, .{});
    defer root.close(std.testing.io);
    var result = try writeLauncher(std.testing.io, allocator, root, home, .{ .os = .linux, .arch = .x86_64 });
    defer result.deinit(allocator);
    var launcher = try std.Io.Dir.openFileAbsolute(std.testing.io, result.launcher_path, .{});
    defer launcher.close(std.testing.io);
    var buffer: [4096]u8 = undefined;
    var reader = launcher.reader(std.testing.io, &buffer);
    const contents = try reader.interface.allocRemaining(allocator, .limited(8192));
    defer allocator.free(contents);
    try std.testing.expect(std.mem.indexOf(u8, contents, "desktop/current.txt") != null);
    try std.testing.expect(std.mem.indexOf(u8, contents, "APP_ROOT=\"$ROOT/desktop/versions/$VERSION/app\"") != null);
    try std.testing.expect(std.mem.indexOf(u8, contents, "cd \"$APP_ROOT\"") != null);
}
