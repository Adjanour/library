const std = @import("std");
const manifest = @import("manifest.zig");
const planner = @import("planner.zig");
const platform = @import("platform.zig");
const download = @import("download.zig");

pub const Options = struct {
    root: []const u8,
    ca_cert_path: ?[]const u8 = null,
    allow_insecure_http: bool = false,
};

pub fn library(io: std.Io, allocator: std.mem.Allocator, release: *const manifest.Manifest, target: platform.Target, selection: planner.Selection, options: Options) !void {
    const plan = try planner.create(release, target, selection);
    if (!std.fs.path.isAbsolute(options.root)) return error.InstallRootMustBeAbsolute;
    const item = plan.items[0];
    if (item.package.id != .library) return error.LibraryPackageMissing;
    try validateVersion(item.package.version);

    try std.Io.Dir.cwd().createDirPath(io, options.root);
    var root = try std.Io.Dir.openDirAbsolute(io, options.root, .{});
    defer root.close(io);
    try root.createDirPath(io, "library/versions");

    const relative_version = try std.fmt.allocPrint(allocator, "library/versions/{s}", .{item.package.version});
    defer allocator.free(relative_version);
    if (root.openDir(io, relative_version, .{})) |existing| {
        existing.close(io);
        return error.VersionAlreadyInstalled;
    } else |err| switch (err) {
        error.FileNotFound => {},
        else => return err,
    }

    root.createDir(io, "library/.library-staging", .default_dir) catch |err| switch (err) {
        error.PathAlreadyExists => return error.InstallInProgress,
        else => return err,
    };
    var staging = try root.openDir(io, "library/.library-staging", .{});
    errdefer staging.close(io);
    const cache_dir = try std.fmt.allocPrint(allocator, "{s}/cache", .{options.root});
    defer allocator.free(cache_dir);
    const source = try download.acquire(io, allocator, item.artifact, cache_dir, .{ .ca_cert_path = options.ca_cert_path, .allow_insecure_http = options.allow_insecure_http });
    defer allocator.free(source);

    const staging_path = try std.fmt.allocPrint(allocator, "{s}/library/.library-staging", .{options.root});
    defer allocator.free(staging_path);
    if (item.artifact.kind == .tar_gz) {
        if (target.os != .linux) return error.UnsupportedArchiveTarget;
        try extractLinuxArchive(io, allocator, source, staging_path);
    } else {
        const destination = try std.fmt.allocPrint(allocator, "{s}/library/.library-staging/library-artifact", .{options.root});
        defer allocator.free(destination);
        try std.Io.Dir.copyFileAbsolute(source, destination, io, .{ .make_path = true, .replace = true });
    }

    var receipt = try staging.createFileAtomic(io, "receipt.txt", .{ .replace = true });
    defer receipt.deinit(io);
    var receipt_buffer: [512]u8 = undefined;
    var writer = receipt.file.writer(io, &receipt_buffer);
    try writer.interface.print("package=library\nversion={s}\nsha256={s}\n", .{ item.package.version, item.artifact.sha256 });
    try writer.flush();
    try receipt.replace(io);
    staging.close(io);

    try root.rename("library/.library-staging", root, relative_version, io);
    const current = readPointer(io, allocator, root, "library/current.txt") catch |err| switch (err) {
        error.FileNotFound => null,
        else => return err,
    };
    defer if (current) |value| allocator.free(value);
    if (current) |previous| try writePointer(io, root, "library/previous.txt", previous);
    try writePointer(io, root, "library/current.txt", item.package.version);
    try writeLauncher(io, root);
}

fn extractLinuxArchive(io: std.Io, allocator: std.mem.Allocator, source: []const u8, destination: []const u8) !void {
    const result = try std.process.run(allocator, io, .{
        .argv = &.{ "tar", "-xzf", source, "-C", destination, "--strip-components=1", "--no-same-owner", "--no-same-permissions" },
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

fn writeLauncher(io: std.Io, root: std.Io.Dir) !void {
    try root.createDirPath(io, "library/bin");
    var launcher = try root.createFileAtomic(io, "library/bin/library", .{ .replace = true });
    defer launcher.deinit(io);
    try launcher.file.setPermissions(io, .executable_file);
    var buffer: [512]u8 = undefined;
    var writer = launcher.file.writer(io, &buffer);
    try writer.interface.writeAll(
        "#!/bin/sh\n" ++
            "set -eu\n" ++
            "BASE=$(CDPATH= cd -- \"$(dirname -- \"$0\")/..\" && pwd)\n" ++
            "VERSION=$(cat \"$BASE/current.txt\")\n" ++
            "exec \"$BASE/versions/$VERSION/app\" \"$@\"\n",
    );
    try writer.flush();
    try launcher.replace(io);
}

pub fn rollback(io: std.Io, allocator: std.mem.Allocator, root_path: []const u8) !void {
    if (!std.fs.path.isAbsolute(root_path)) return error.InstallRootMustBeAbsolute;
    var root = try std.Io.Dir.openDirAbsolute(io, root_path, .{});
    defer root.close(io);
    const current = try readPointer(io, allocator, root, "library/current.txt");
    defer allocator.free(current);
    const previous = try readPointer(io, allocator, root, "library/previous.txt");
    defer allocator.free(previous);
    try validateVersion(previous);
    const version_path = try std.fmt.allocPrint(allocator, "library/versions/{s}", .{previous});
    defer allocator.free(version_path);
    var version_dir = try root.openDir(io, version_path, .{});
    version_dir.close(io);
    try writePointer(io, root, "library/previous.txt", current);
    try writePointer(io, root, "library/current.txt", previous);
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
