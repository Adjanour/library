const std = @import("std");

pub const Signed = struct {
    payload: []const u8,
    signature_hex: []const u8,
    public_key_hex: []const u8,
};

pub fn parse(bytes: []const u8) !Signed {
    const separator = std.mem.indexOf(u8, bytes, "\n\n") orelse return error.InvalidSignedManifest;
    const headers = bytes[0..separator];
    const payload = bytes[separator + 2 ..];
    if (payload.len == 0) return error.InvalidSignedManifest;

    var signature_hex: ?[]const u8 = null;
    var public_key_hex: ?[]const u8 = null;
    var lines = std.mem.splitScalar(u8, headers, '\n');
    while (lines.next()) |line| {
        if (std.mem.startsWith(u8, line, "signature=")) {
            signature_hex = line["signature=".len..];
        } else if (std.mem.startsWith(u8, line, "public_key=")) {
            public_key_hex = line["public_key=".len..];
        }
    }

    return .{
        .payload = payload,
        .signature_hex = signature_hex orelse return error.InvalidSignedManifest,
        .public_key_hex = public_key_hex orelse return error.InvalidSignedManifest,
    };
}

test "signed manifest envelope separates headers from payload" {
    const signed = try parse("signature=aa\npublic_key=bb\n\n{\"schema\":1}");
    try std.testing.expectEqualStrings("aa", signed.signature_hex);
    try std.testing.expectEqualStrings("bb", signed.public_key_hex);
    try std.testing.expectEqualStrings("{\"schema\":1}", signed.payload);
}
