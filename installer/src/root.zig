pub const manifest = @import("manifest.zig");
pub const planner = @import("planner.zig");
pub const platform = @import("platform.zig");
pub const verify = @import("verify.zig");
pub const signed_manifest = @import("signed_manifest.zig");
pub const install = @import("install.zig");
pub const download = @import("download.zig");

const std = @import("std");

const fixture =
    \\{
    \\  "schema": 1,
    \\  "channel": "test",
    \\  "generated_at": "2026-09-27T00:00:00Z",
    \\  "packages": [
    \\    {
    \\      "id": "library",
    \\      "display_name": "Library",
    \\      "version": "0.1.1",
    \\      "license": "MIT",
    \\      "source_url": "https://example.invalid/library",
    \\      "optional": false,
    \\      "artifacts": [
    \\        {"os":"linux","arch":"x86_64","url":"https://example.invalid/library.AppImage","sha256":"00","size":1,"kind":"appimage"}
    \\      ]
    \\    },
    \\    {
    \\      "id": "readest",
    \\      "display_name": "Readest",
    \\      "version": "1.0.0",
    \\      "license": "AGPL-3.0",
    \\      "source_url": "https://example.invalid/readest",
    \\      "optional": true,
    \\      "artifacts": [
    \\        {"os":"linux","arch":"x86_64","url":"https://example.invalid/readest.AppImage","sha256":"00","size":1,"kind":"appimage"}
    \\      ]
    \\    }
    \\  ]
    \\}
;

test "manifest parses and rejects unsupported schemas" {
    var parsed = try manifest.parse(std.testing.allocator, fixture);
    defer parsed.deinit();
    try std.testing.expectEqual(@as(u32, 1), parsed.value.schema);
    try std.testing.expectEqual(@as(usize, 2), parsed.value.packages.len);

    const unsupported = try std.mem.replaceOwned(u8, std.testing.allocator, fixture, "\"schema\": 1", "\"schema\": 2");
    defer std.testing.allocator.free(unsupported);
    try std.testing.expectError(error.UnsupportedManifestSchema, manifest.parse(std.testing.allocator, unsupported));
}

test "planner always includes Library and selected optional readers" {
    var parsed = try manifest.parse(std.testing.allocator, fixture);
    defer parsed.deinit();
    const target: platform.Target = .{ .os = .linux, .arch = .x86_64 };

    const base = try planner.create(&parsed.value, target, .{});
    try std.testing.expectEqual(@as(usize, 1), base.len);
    try std.testing.expectEqual(manifest.PackageId.library, base.items[0].package.id);

    const with_readest = try planner.create(&parsed.value, target, .{ .readest = true });
    try std.testing.expectEqual(@as(usize, 2), with_readest.len);
    try std.testing.expectEqual(manifest.PackageId.readest, with_readest.items[1].package.id);
}

test "SHA-256 verification accepts only the expected digest" {
    try std.testing.expect(verify.matchesHex("abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"));
    try std.testing.expect(!verify.matchesHex("abcd", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"));
    try std.testing.expect(!verify.matchesHex("abc", "not-a-digest"));
}

test "Ed25519 manifest signatures are verified" {
    const Ed25519 = std.crypto.sign.Ed25519;
    const key_pair = Ed25519.KeyPair.generate(std.testing.io);
    const signature = try key_pair.sign(fixture, null);
    const signature_hex = std.fmt.bytesToHex(signature.toBytes(), .lower);
    const public_key_hex = std.fmt.bytesToHex(key_pair.public_key.toBytes(), .lower);

    try verify.verifyManifestSignature(fixture, &signature_hex, &public_key_hex);
    try std.testing.expectError(
        error.SignatureVerificationFailed,
        verify.verifyManifestSignature("tampered", &signature_hex, &public_key_hex),
    );
}
