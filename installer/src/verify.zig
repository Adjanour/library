const std = @import("std");

const Sha256 = std.crypto.hash.sha2.Sha256;
const Ed25519 = std.crypto.sign.Ed25519;

pub fn digest(bytes: []const u8) [Sha256.digest_length]u8 {
    var output: [Sha256.digest_length]u8 = undefined;
    Sha256.hash(bytes, &output, .{});
    return output;
}

pub fn matchesHex(bytes: []const u8, expected_hex: []const u8) bool {
    if (expected_hex.len != Sha256.digest_length * 2) return false;
    var expected: [Sha256.digest_length]u8 = undefined;
    _ = std.fmt.hexToBytes(&expected, expected_hex) catch return false;
    return std.mem.eql(u8, &digest(bytes), &expected);
}

pub fn isDigestHex(value: []const u8) bool {
    if (value.len != Sha256.digest_length * 2) return false;
    var decoded: [Sha256.digest_length]u8 = undefined;
    _ = std.fmt.hexToBytes(&decoded, value) catch return false;
    return true;
}

pub fn fileMatches(io: std.Io, path: []const u8, expected_hex: []const u8) !bool {
    if (!isDigestHex(expected_hex)) return false;
    var file = if (std.fs.path.isAbsolute(path))
        try std.Io.Dir.openFileAbsolute(io, path, .{})
    else
        try std.Io.Dir.cwd().openFile(io, path, .{});
    defer file.close(io);

    var buffer: [64 * 1024]u8 = undefined;
    var reader = file.reader(io, &buffer);
    var hasher = Sha256.init(.{});
    var chunk: [64 * 1024]u8 = undefined;
    while (true) {
        const count = try reader.interface.readSliceShort(&chunk);
        if (count == 0) break;
        hasher.update(chunk[0..count]);
    }
    var actual: [Sha256.digest_length]u8 = undefined;
    hasher.final(&actual);
    var decoded: [Sha256.digest_length]u8 = undefined;
    _ = try std.fmt.hexToBytes(&decoded, expected_hex);
    return std.mem.eql(u8, &actual, &decoded);
}

pub fn verifyManifestSignature(
    bytes: []const u8,
    signature_hex: []const u8,
    public_key_hex: []const u8,
) !void {
    if (signature_hex.len != Ed25519.Signature.encoded_length * 2) return error.InvalidSignatureEncoding;
    if (public_key_hex.len != Ed25519.PublicKey.encoded_length * 2) return error.InvalidPublicKeyEncoding;

    var signature_bytes: [Ed25519.Signature.encoded_length]u8 = undefined;
    var public_key_bytes: [Ed25519.PublicKey.encoded_length]u8 = undefined;
    _ = try std.fmt.hexToBytes(&signature_bytes, signature_hex);
    _ = try std.fmt.hexToBytes(&public_key_bytes, public_key_hex);

    const signature = Ed25519.Signature.fromBytes(signature_bytes);
    const public_key = try Ed25519.PublicKey.fromBytes(public_key_bytes);
    try signature.verify(bytes, public_key);
}
