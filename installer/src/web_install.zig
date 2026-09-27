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

    const app = try planner.findPackageArtifact(release, .web_preview, target);
    const runtime = try planner.findPackageArtifact(release, .deno, target);
    try validateVersion(app.package.version);
    try validateVersion(runtime.package.version);
    if (app.artifact.kind != .portable_zip or runtime.artifact.kind != .portable_zip) {
        return error.UnsupportedWebPreviewArtifact;
    }

    try std.Io.Dir.cwd().createDirPath(io, options.root);
    var root = try std.Io.Dir.openDirAbsolute(io, options.root, .{});
    defer root.close(io);
    try root.createDirPath(io, "web-preview/versions");
    try root.createDirPath(io, "runtime/deno/versions");

    const app_version_path = try std.fmt.allocPrint(allocator, "web-preview/versions/{s}", .{app.package.version});
    defer allocator.free(app_version_path);
    const runtime_version_path = try std.fmt.allocPrint(allocator, "runtime/deno/versions/{s}", .{runtime.package.version});
    defer allocator.free(runtime_version_path);

    const cache_dir = try std.fmt.allocPrint(allocator, "{s}/cache", .{options.root});
    defer allocator.free(cache_dir);
    const acquire_options: download.Options = .{
        .ca_cert_path = options.ca_cert_path,
        .allow_insecure_http = options.allow_insecure_http,
    };

    if (!directoryExists(io, root, runtime_version_path)) {
        try printStatus(io, "Downloading and verifying the Deno runtime...");
        const runtime_source = try download.acquire(io, allocator, runtime.artifact, cache_dir, acquire_options);
        defer allocator.free(runtime_source);
        try extractVersion(io, allocator, root, options.root, runtime_source, "runtime/deno/.staging", runtime_version_path);
        try makeRuntimeExecutable(io, root, runtime_version_path, target);
        try writeReceipt(io, root, runtime_version_path, runtime.package.version, runtime.artifact.sha256);
    } else {
        try printStatus(io, "Using the installed Deno runtime.");
    }

    if (!directoryExists(io, root, app_version_path)) {
        try printStatus(io, "Downloading and verifying Library Web Preview...");
        const app_source = try download.acquire(io, allocator, app.artifact, cache_dir, acquire_options);
        defer allocator.free(app_source);
        try extractVersion(io, allocator, root, options.root, app_source, "web-preview/.staging", app_version_path);
        try writeReceipt(io, root, app_version_path, app.package.version, app.artifact.sha256);
    } else {
        try printStatus(io, "Using the installed Library Web Preview.");
    }

    const current_app = readPointer(io, allocator, root, "web-preview/current.txt") catch |err| switch (err) {
        error.FileNotFound => null,
        else => return err,
    };
    defer if (current_app) |value| allocator.free(value);
    if (current_app) |previous| {
        if (!std.mem.eql(u8, previous, app.package.version)) {
            try writePointer(io, root, "web-preview/previous.txt", previous);
        }
    }
    try writePointer(io, root, "web-preview/current.txt", app.package.version);
    try writePointer(io, root, "runtime/deno/current.txt", runtime.package.version);
    try printStatus(io, "Caching locked dependencies for offline restarts...");
    try cacheDependencies(io, allocator, options, app.package.version, runtime.package.version, target);
    try printStatus(io, "Creating the launcher...");
    var result = try writeLauncher(io, allocator, root, options.root, target);
    errdefer result.deinit(allocator);
    if (options.create_shortcuts) {
        result.shortcut_path = try createPlatformShortcut(io, allocator, options, result.launcher_path, app.package.version, target);
    }
    return result;
}

fn printStatus(io: std.Io, message: []const u8) !void {
    var buffer: [512]u8 = undefined;
    var writer = std.Io.File.stdout().writer(io, &buffer);
    try writer.interface.print("{s}\n", .{message});
    try writer.interface.flush();
}

fn cacheDependencies(
    io: std.Io,
    allocator: std.mem.Allocator,
    options: Options,
    app_version: []const u8,
    runtime_version: []const u8,
    target: platform.Target,
) !void {
    const runtime_name = if (target.os == .windows) "deno.exe" else "deno";
    const runtime_path = try std.fs.path.join(allocator, &.{ options.root, "runtime", "deno", "versions", runtime_version, runtime_name });
    defer allocator.free(runtime_path);
    const main_path = try std.fs.path.join(allocator, &.{ options.root, "web-preview", "versions", app_version, "deno", "src", "main.ts" });
    defer allocator.free(main_path);
    const lock_path = try std.fs.path.join(allocator, &.{ options.root, "web-preview", "versions", app_version, "deno", "deno.lock" });
    defer allocator.free(lock_path);
    const cache_path = try std.fs.path.join(allocator, &.{ options.root, "runtime", "deno", "cache" });
    defer allocator.free(cache_path);
    const lock_arg = try std.fmt.allocPrint(allocator, "--lock={s}", .{lock_path});
    defer allocator.free(lock_arg);

    var environment = if (options.environ_map) |parent|
        try parent.clone(allocator)
    else
        std.process.Environ.Map.init(allocator);
    defer environment.deinit();
    try environment.put("DENO_DIR", cache_path);
    try environment.put("DENO_NO_UPDATE_CHECK", "1");

    const result = try std.process.run(allocator, io, .{
        .argv = &.{ runtime_path, "cache", "--frozen=true", lock_arg, main_path },
        .environ_map = &environment,
        .stdout_limit = .limited(1024 * 1024),
        .stderr_limit = .limited(1024 * 1024),
    });
    defer allocator.free(result.stdout);
    defer allocator.free(result.stderr);
    switch (result.term) {
        .exited => |code| if (code != 0) return error.DependencyCacheFailed,
        else => return error.DependencyCacheFailed,
    }
}

fn extractVersion(
    io: std.Io,
    allocator: std.mem.Allocator,
    root: std.Io.Dir,
    root_path: []const u8,
    source: []const u8,
    staging_relative: []const u8,
    version_relative: []const u8,
) !void {
    if (directoryExists(io, root, staging_relative)) return error.InstallInProgress;
    try root.createDirPath(io, staging_relative);
    errdefer root.deleteTree(io, staging_relative) catch {};

    const staging_absolute = try std.fs.path.join(allocator, &.{ root_path, staging_relative });
    defer allocator.free(staging_absolute);
    var destination = try std.Io.Dir.openDirAbsolute(io, staging_absolute, .{});
    defer destination.close(io);

    var archive = try std.Io.Dir.openFileAbsolute(io, source, .{});
    defer archive.close(io);
    var read_buffer: [64 * 1024]u8 = undefined;
    var reader = archive.reader(io, &read_buffer);
    try std.zip.extract(destination, &reader, .{});
    try root.rename(staging_relative, root, version_relative, io);
}

fn makeRuntimeExecutable(io: std.Io, root: std.Io.Dir, version_path: []const u8, target: platform.Target) !void {
    if (target.os == .windows) return;
    const executable = try std.fmt.allocPrint(std.heap.page_allocator, "{s}/deno", .{version_path});
    defer std.heap.page_allocator.free(executable);
    var file = try root.openFile(io, executable, .{ .mode = .read_write });
    defer file.close(io);
    try file.setPermissions(io, .executable_file);
}

fn writeReceipt(io: std.Io, root: std.Io.Dir, version_path: []const u8, version: []const u8, sha256: []const u8) !void {
    const receipt_path = try std.fmt.allocPrint(std.heap.page_allocator, "{s}/receipt.txt", .{version_path});
    defer std.heap.page_allocator.free(receipt_path);
    var receipt = try root.createFileAtomic(io, receipt_path, .{ .replace = true });
    defer receipt.deinit(io);
    var buffer: [512]u8 = undefined;
    var writer = receipt.file.writer(io, &buffer);
    try writer.interface.print("version={s}\nsha256={s}\n", .{ version, sha256 });
    try writer.flush();
    try receipt.replace(io);
}

fn writeLauncher(io: std.Io, allocator: std.mem.Allocator, root: std.Io.Dir, root_path: []const u8, target: platform.Target) !Result {
    try root.createDirPath(io, "web-preview/bin");
    const relative_path = if (target.os == .windows)
        "web-preview/bin/library-web-preview.cmd"
    else
        "web-preview/bin/library-web-preview";
    var launcher = try root.createFileAtomic(io, relative_path, .{ .replace = true });
    defer launcher.deinit(io);
    if (target.os != .windows) try launcher.file.setPermissions(io, .executable_file);
    var buffer: [4096]u8 = undefined;
    var writer = launcher.file.writer(io, &buffer);
    if (target.os == .windows) {
        try writer.interface.writeAll(
            "@echo off\r\n" ++
                "setlocal\r\n" ++
                "set \"ROOT=%~dp0..\\..\"\r\n" ++
                "if \"%LIBRARY_PORT%\"==\"\" set \"LIBRARY_PORT=8080\"\r\n" ++
                "set \"DENO_DIR=%ROOT%\\runtime\\deno\\cache\"\r\n" ++
                "set \"DENO_NO_UPDATE_CHECK=1\"\r\n" ++
                "set /p APP_VERSION=<\"%ROOT%\\web-preview\\current.txt\"\r\n" ++
                "set /p DENO_VERSION=<\"%ROOT%\\runtime\\deno\\current.txt\"\r\n" ++
                "start \"\" /b powershell.exe -NoProfile -WindowStyle Hidden -Command \"Start-Sleep -Seconds 1; Start-Process 'http://localhost:%LIBRARY_PORT%'\"\r\n" ++
                "\"%ROOT%\\runtime\\deno\\versions\\%DENO_VERSION%\\deno.exe\" run --allow-all \"%ROOT%\\web-preview\\versions\\%APP_VERSION%\\deno\\src\\main.ts\" %LIBRARY_PORT%\r\n",
        );
    } else {
        const open_command = if (target.os == .macos) "open" else "xdg-open";
        try writer.interface.print(
            "#!/bin/sh\n" ++
                "set -eu\n" ++
                "ROOT=$(CDPATH= cd -- \"$(dirname -- \"$0\")/../..\" && pwd)\n" ++
                "PORT=${{LIBRARY_PORT:-8080}}\n" ++
                "export DENO_DIR=\"$ROOT/runtime/deno/cache\"\n" ++
                "export DENO_NO_UPDATE_CHECK=1\n" ++
                "APP_VERSION=$(cat \"$ROOT/web-preview/current.txt\")\n" ++
                "DENO_VERSION=$(cat \"$ROOT/runtime/deno/current.txt\")\n" ++
                "(sleep 1; command -v {s} >/dev/null 2>&1 && {s} \"http://localhost:$PORT\" >/dev/null 2>&1) &\n" ++
                "exec \"$ROOT/runtime/deno/versions/$DENO_VERSION/deno\" run --allow-all \"$ROOT/web-preview/versions/$APP_VERSION/deno/src/main.ts\" \"$PORT\"\n",
            .{ open_command, open_command },
        );
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
        .windows => null,
        .linux => try createLinuxShortcut(io, allocator, environ.*, launcher_path),
        .macos => try createMacShortcut(io, allocator, environ.*, launcher_path, app_version),
    };
}

fn createLinuxShortcut(
    io: std.Io,
    allocator: std.mem.Allocator,
    environ: std.process.Environ.Map,
    launcher_path: []const u8,
) ![]u8 {
    try validateShortcutPath(launcher_path);
    const data_home = if (environ.get("XDG_DATA_HOME")) |value|
        try allocator.dupe(u8, value)
    else
        try std.fs.path.join(allocator, &.{
            environ.get("HOME") orelse return error.HomeDirectoryUnavailable,
            ".local",
            "share",
        });
    defer allocator.free(data_home);
    const applications_dir = try std.fs.path.join(allocator, &.{ data_home, "applications" });
    defer allocator.free(applications_dir);
    try std.Io.Dir.cwd().createDirPath(io, applications_dir);
    var directory = try std.Io.Dir.openDirAbsolute(io, applications_dir, .{});
    defer directory.close(io);

    var entry = try directory.createFileAtomic(io, "library-web-preview.desktop", .{ .replace = true });
    defer entry.deinit(io);
    var buffer: [2048]u8 = undefined;
    var writer = entry.file.writer(io, &buffer);
    try writer.interface.print(
        "[Desktop Entry]\n" ++
            "Type=Application\n" ++
            "Name=Library Web Preview\n" ++
            "Comment=Read local books and papers\n" ++
            "Exec=\"{s}\"\n" ++
            "Icon=accessories-ebook-reader\n" ++
            "Terminal=true\n" ++
            "Categories=Office;Viewer;\n" ++
            "StartupNotify=true\n",
        .{launcher_path},
    );
    try writer.flush();
    try entry.replace(io);
    return std.fs.path.join(allocator, &.{ applications_dir, "library-web-preview.desktop" });
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
    const app_path = try std.fs.path.join(allocator, &.{ home, "Applications", "Library Web Preview.app" });
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
            "<key>CFBundleDevelopmentRegion</key><string>en</string>\n" ++
            "<key>CFBundleExecutable</key><string>Library Web Preview</string>\n" ++
            "<key>CFBundleIdentifier</key><string>com.bernard.library.web-preview</string>\n" ++
            "<key>CFBundleName</key><string>Library Web Preview</string>\n" ++
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
    var launcher = try executable_dir.createFileAtomic(io, "Library Web Preview", .{ .replace = true });
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

test "Linux integration writes a user-owned desktop entry" {
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    const allocator = std.testing.allocator;
    const cwd = try std.process.currentPathAlloc(std.testing.io, allocator);
    defer allocator.free(cwd);
    const home = try std.fs.path.join(allocator, &.{ cwd, ".zig-cache", "tmp", tmp.sub_path[0..] });
    defer allocator.free(home);
    const data_home = try std.fs.path.join(allocator, &.{ home, "data" });
    defer allocator.free(data_home);
    const launcher_path = try std.fs.path.join(allocator, &.{ home, "library", "web-preview", "bin", "library-web-preview" });
    defer allocator.free(launcher_path);
    var environ = std.process.Environ.Map.init(allocator);
    defer environ.deinit();
    try environ.put("HOME", home);
    try environ.put("XDG_DATA_HOME", data_home);

    const shortcut = try createLinuxShortcut(std.testing.io, allocator, environ, launcher_path);
    defer allocator.free(shortcut);
    var shortcut_file = try std.Io.Dir.openFileAbsolute(std.testing.io, shortcut, .{});
    defer shortcut_file.close(std.testing.io);
    var buffer: [2048]u8 = undefined;
    var reader = shortcut_file.reader(std.testing.io, &buffer);
    const contents = try reader.interface.allocRemaining(allocator, .limited(4096));
    defer allocator.free(contents);
    try std.testing.expect(std.mem.indexOf(u8, contents, launcher_path) != null);
    try std.testing.expect(std.mem.indexOf(u8, contents, "Terminal=true") != null);
}

test "macOS integration writes a launchable user app bundle" {
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    const allocator = std.testing.allocator;
    const cwd = try std.process.currentPathAlloc(std.testing.io, allocator);
    defer allocator.free(cwd);
    const home = try std.fs.path.join(allocator, &.{ cwd, ".zig-cache", "tmp", tmp.sub_path[0..] });
    defer allocator.free(home);
    const launcher_path = try std.fs.path.join(allocator, &.{ home, "Library Preview", "web-preview", "bin", "library-web-preview" });
    defer allocator.free(launcher_path);
    var environ = std.process.Environ.Map.init(allocator);
    defer environ.deinit();
    try environ.put("HOME", home);

    const app_path = try createMacShortcut(std.testing.io, allocator, environ, launcher_path, "0.1.1-test");
    defer allocator.free(app_path);
    var app = try std.Io.Dir.openDirAbsolute(std.testing.io, app_path, .{});
    defer app.close(std.testing.io);
    const plist = try app.readFileAlloc(std.testing.io, "Contents/Info.plist", allocator, .limited(8192));
    defer allocator.free(plist);
    const launcher = try app.readFileAlloc(std.testing.io, "Contents/MacOS/Library Web Preview", allocator, .limited(4096));
    defer allocator.free(launcher);
    try std.testing.expect(std.mem.indexOf(u8, plist, "com.bernard.library.web-preview") != null);
    try std.testing.expect(std.mem.indexOf(u8, launcher, launcher_path) != null);
}
