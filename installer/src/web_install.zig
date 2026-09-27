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
};

pub const Result = struct {
    launcher_path: []u8,

    pub fn deinit(self: Result, allocator: std.mem.Allocator) void {
        allocator.free(self.launcher_path);
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
    return writeLauncher(io, allocator, root, options.root, target);
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
