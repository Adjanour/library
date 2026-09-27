const std = @import("std");

pub const Os = enum { linux, macos, windows };
pub const Arch = enum { x86_64, aarch64 };
pub const PackageId = enum { library, readest, sioyek };
pub const InstallKind = enum { appimage, deb, dmg, msi, exe, portable_zip, tar_gz };

pub const Artifact = struct {
    os: Os,
    arch: Arch,
    url: []const u8,
    sha256: []const u8,
    size: u64,
    kind: InstallKind,
};

pub const Package = struct {
    id: PackageId,
    display_name: []const u8,
    version: []const u8,
    license: []const u8,
    source_url: []const u8,
    optional: bool,
    artifacts: []const Artifact,
};

pub const Manifest = struct {
    schema: u32,
    channel: []const u8,
    generated_at: []const u8,
    packages: []const Package,
};

pub fn parse(allocator: std.mem.Allocator, bytes: []const u8) !std.json.Parsed(Manifest) {
    const parsed = try std.json.parseFromSlice(Manifest, allocator, bytes, .{
        .ignore_unknown_fields = false,
    });
    errdefer parsed.deinit();
    if (parsed.value.schema != 1) return error.UnsupportedManifestSchema;
    return parsed;
}
