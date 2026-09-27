const std = @import("std");
const installer = @import("installer");

pub fn main(init: std.process.Init) !void {
    var args = try std.process.Args.Iterator.initAllocator(init.minimal.args, init.gpa);
    defer args.deinit();
    _ = args.next();

    const command = args.next() orelse "help";
    if (std.mem.eql(u8, command, "help") or std.mem.eql(u8, command, "--help")) {
        try printHelp(init.io);
        return;
    }

    if (std.mem.eql(u8, command, "plan")) {
        try plan(init.io, init.gpa, &args);
        return;
    }

    if (std.mem.eql(u8, command, "verify-file")) {
        const path = args.next() orelse return error.MissingPath;
        const expected = args.next() orelse return error.MissingDigest;
        try verifyFile(init.io, path, expected);
        return;
    }

    if (std.mem.eql(u8, command, "install")) {
        try install(init.io, init.gpa, &args);
        return;
    }

    if (std.mem.eql(u8, command, "rollback")) {
        const root = args.next() orelse return error.MissingInstallRoot;
        try installer.install.rollback(init.io, init.gpa, root);
        return;
    }

    if (std.mem.eql(u8, command, "sign-manifest")) {
        try signManifest(init.io, init.gpa, &args);
        return;
    }

    return error.UnknownCommand;
}

fn printHelp(io: std.Io) !void {
    var buffer: [2048]u8 = undefined;
    var writer = std.Io.File.stdout().writer(io, &buffer);
    try writer.interface.writeAll(
        "Library Setup (development planner)\n\n" ++
            "Usage:\n" ++
            "  library-setup plan [--with-readest] [--with-sioyek]\n" ++
            "  library-setup verify-file <path> <sha256>\n" ++
            "  library-setup install <signed-manifest> --root <absolute-directory> [--ca-cert <absolute-pem>] [--allow-http]\n" ++
            "  library-setup rollback <absolute-directory>\n" ++
            "  library-setup sign-manifest <payload> <output> <seed-hex>\n",
    );
    try writer.interface.flush();
}

fn signManifest(io: std.Io, allocator: std.mem.Allocator, args: *std.process.Args.Iterator) !void {
    const payload_path = args.next() orelse return error.MissingManifest;
    const output_path = args.next() orelse return error.MissingOutput;
    const seed_hex = args.next() orelse return error.MissingSigningSeed;
    var seed: [std.crypto.sign.Ed25519.KeyPair.seed_length]u8 = undefined;
    _ = try std.fmt.hexToBytes(&seed, seed_hex);
    const key_pair = try std.crypto.sign.Ed25519.KeyPair.generateDeterministic(seed);
    const payload = try std.Io.Dir.cwd().readFileAlloc(io, payload_path, allocator, .limited(8 * 1024 * 1024));
    defer allocator.free(payload);
    const signature = try key_pair.sign(payload, null);
    var output = try std.Io.Dir.cwd().createFile(io, output_path, .{});
    defer output.close(io);
    var buffer: [1024]u8 = undefined;
    var writer = output.writer(io, &buffer);
    try writer.interface.print("signature={s}\npublic_key={s}\n\n", .{
        std.fmt.bytesToHex(signature.toBytes(), .lower),
        std.fmt.bytesToHex(key_pair.public_key.toBytes(), .lower),
    });
    try writer.interface.writeAll(payload);
    try writer.interface.flush();
}

fn install(io: std.Io, allocator: std.mem.Allocator, args: *std.process.Args.Iterator) !void {
    const manifest_path = args.next() orelse return error.MissingManifest;
    var root: ?[]const u8 = null;
    var ca_cert: ?[]const u8 = null;
    var allow_http = false;
    while (args.next()) |arg| {
        if (std.mem.eql(u8, arg, "--root")) {
            root = args.next() orelse return error.MissingInstallRoot;
        } else if (std.mem.eql(u8, arg, "--ca-cert")) {
            ca_cert = args.next() orelse return error.MissingCaCertificate;
        } else if (std.mem.eql(u8, arg, "--allow-http")) {
            allow_http = true;
        } else {
            return error.UnknownInstallOption;
        }
    }
    const install_root = root orelse return error.MissingInstallRoot;
    const bytes = try std.Io.Dir.cwd().readFileAlloc(io, manifest_path, allocator, .limited(8 * 1024 * 1024));
    defer allocator.free(bytes);
    const signed = try installer.signed_manifest.parse(bytes);
    try installer.verify.verifyManifestSignature(signed.payload, signed.signature_hex, signed.public_key_hex);
    var parsed = try installer.manifest.parse(allocator, signed.payload);
    defer parsed.deinit();
    const target = try installer.platform.current();
    try installer.install.library(io, allocator, &parsed.value, target, .{}, .{
        .root = install_root,
        .ca_cert_path = ca_cert,
        .allow_insecure_http = allow_http,
    });
}

fn plan(io: std.Io, allocator: std.mem.Allocator, args: *std.process.Args.Iterator) !void {
    var selection: installer.planner.Selection = .{};
    while (args.next()) |arg| {
        if (std.mem.eql(u8, arg, "--with-readest")) {
            selection.readest = true;
        } else if (std.mem.eql(u8, arg, "--with-sioyek")) {
            selection.sioyek = true;
        } else {
            return error.UnknownPlanOption;
        }
    }

    const manifest_bytes = try std.Io.Dir.cwd().readFileAlloc(
        io,
        "manifests/dev.json",
        allocator,
        .limited(1024 * 1024),
    );
    defer allocator.free(manifest_bytes);
    var parsed = try installer.manifest.parse(allocator, manifest_bytes);
    defer parsed.deinit();
    const target = try installer.platform.current();
    const selected = try installer.planner.create(&parsed.value, target, selection);

    var buffer: [4096]u8 = undefined;
    var writer = std.Io.File.stdout().writer(io, &buffer);
    try writer.interface.print("target: {s}/{s}\n", .{ @tagName(target.os), @tagName(target.arch) });
    for (selected.slice()) |item| {
        if (!installer.verify.isDigestHex(item.artifact.sha256)) return error.UntrustedManifest;
        try writer.interface.print("{s} {s} {s} {s}\n", .{
            @tagName(item.package.id),
            item.package.version,
            @tagName(item.artifact.kind),
            item.artifact.url,
        });
    }
    try writer.interface.flush();
}

fn verifyFile(io: std.Io, path: []const u8, expected: []const u8) !void {
    if (!installer.verify.isDigestHex(expected)) return error.InvalidDigest;
    const cwd = std.Io.Dir.cwd();
    var file = try cwd.openFile(io, path, .{});
    defer file.close(io);

    var file_buffer: [64 * 1024]u8 = undefined;
    var reader = file.reader(io, &file_buffer);
    var hasher = std.crypto.hash.sha2.Sha256.init(.{});
    var chunk: [64 * 1024]u8 = undefined;
    while (true) {
        const count = try reader.interface.readSliceShort(&chunk);
        if (count == 0) break;
        hasher.update(chunk[0..count]);
    }
    var actual: [std.crypto.hash.sha2.Sha256.digest_length]u8 = undefined;
    hasher.final(&actual);
    const actual_hex = std.fmt.bytesToHex(actual, .lower);

    var output_buffer: [256]u8 = undefined;
    var writer = std.Io.File.stdout().writer(io, &output_buffer);
    if (!std.mem.eql(u8, &actual_hex, expected)) {
        try writer.interface.print("sha256 mismatch\nexpected: {s}\nactual:   {s}\n", .{ expected, actual_hex });
        try writer.interface.flush();
        return error.DigestMismatch;
    }
    try writer.interface.print("verified {s}\n", .{path});
    try writer.interface.flush();
}
