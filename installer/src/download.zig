const std = @import("std");
const manifest = @import("manifest.zig");
const verify = @import("verify.zig");

pub const max_attempts = 3;

pub const Options = struct {
    ca_cert_path: ?[]const u8 = null,
    allow_insecure_http: bool = false,
};

pub fn acquire(
    io: std.Io,
    allocator: std.mem.Allocator,
    artifact: *const manifest.Artifact,
    cache_dir: []const u8,
    options: Options,
) ![]u8 {
    if (std.mem.startsWith(u8, artifact.url, "file://")) {
        return allocator.dupe(u8, artifact.url["file://".len..]);
    }
    if (std.mem.startsWith(u8, artifact.url, "http://")) {
        if (!options.allow_insecure_http) return error.InsecureHttpDisabled;
    } else if (!std.mem.startsWith(u8, artifact.url, "https://")) return error.UnsupportedArtifactScheme;
    if (!verify.isDigestHex(artifact.sha256)) return error.UntrustedManifest;
    if (!std.fs.path.isAbsolute(cache_dir)) return error.CacheRootMustBeAbsolute;

    try std.Io.Dir.cwd().createDirPath(io, cache_dir);
    var cache = try std.Io.Dir.openDirAbsolute(io, cache_dir, .{});
    defer cache.close(io);

    const final_name = try std.fmt.allocPrint(allocator, "{s}.artifact", .{artifact.sha256});
    defer allocator.free(final_name);
    const part_name = try std.fmt.allocPrint(allocator, "{s}.part", .{artifact.sha256});
    defer allocator.free(part_name);
    const final_path = try std.fmt.allocPrint(allocator, "{s}/{s}", .{ cache_dir, final_name });
    errdefer allocator.free(final_path);
    const part_path = try std.fmt.allocPrint(allocator, "{s}/{s}", .{ cache_dir, part_name });
    defer allocator.free(part_path);

    if (cache.openFile(io, final_name, .{})) |existing| {
        existing.close(io);
        if (try verify.fileMatches(io, final_path, artifact.sha256)) return final_path;
    } else |_| {}

    var attempt: usize = 0;
    while (attempt < max_attempts) : (attempt += 1) {
        var partial = try cache.createFileAtomic(io, part_name, .{ .replace = true });
        var file_buffer: [64 * 1024]u8 = undefined;
        var writer = partial.file.writer(io, &file_buffer);
        var client: std.http.Client = .{ .allocator = allocator, .io = io };
        if (options.ca_cert_path) |ca_path| {
            try client.ca_bundle.addCertsFromFilePathAbsolute(
                allocator,
                io,
                std.Io.Clock.now(.real, io),
                ca_path,
            );
        }
        const result = client.fetch(.{
            .location = .{ .url = artifact.url },
            .response_writer = &writer.interface,
        }) catch |err| {
            client.deinit();
            partial.deinit(io);
            if (attempt + 1 == max_attempts) return err;
            continue;
        };
        try writer.flush();
        client.deinit();
        try partial.replace(io);
        partial.deinit(io);

        if (result.status.class() != .success) {
            if (attempt + 1 == max_attempts) return error.HttpStatusNotSuccessful;
            continue;
        }

        const downloaded = try cache.openFile(io, part_name, .{});
        defer downloaded.close(io);
        const stat = try downloaded.stat(io);
        if (artifact.size != 0 and stat.size != artifact.size) {
            if (attempt + 1 == max_attempts) return error.ArtifactSizeMismatch;
            continue;
        }
        if (!try verify.fileMatches(io, part_path, artifact.sha256)) {
            if (attempt + 1 == max_attempts) return error.DigestMismatch;
            continue;
        }
        try cache.rename(part_name, cache, final_name, io);
        return final_path;
    }
    return error.DownloadFailed;
}
