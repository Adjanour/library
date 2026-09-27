const std = @import("std");
const builtin = @import("builtin");
const installer = @import("installer");

const web_preview_manifest_url = "https://github.com/Adjanour/library/releases/download/v0.1.1-preview.1/library-web-preview-manifest.signed";
const release_public_key_hex = "21dbc24320a3d009b8ab0a6854859d64c4a936b4033703cfe2edc105c95a682b";

pub fn main(init: std.process.Init) void {
    run(init) catch |err| {
        var buffer: [512]u8 = undefined;
        var writer = std.Io.File.stderr().writer(init.io, &buffer);
        writer.interface.print("\nLibrary Setup failed: {s}\n", .{@errorName(err)}) catch {};
        writer.interface.writeAll("No unverified files were activated. Please include this error when reporting the failure.\n") catch {};
        writer.interface.flush() catch {};
        if (builtin.os.tag == .windows) {
            var child = std.process.spawn(init.io, .{ .argv = &.{ "cmd.exe", "/c", "pause" } }) catch std.process.exit(1);
            _ = child.wait(init.io) catch {};
        }
        std.process.exit(1);
    };
}

fn run(init: std.process.Init) !void {
    var args = try std.process.Args.Iterator.initAllocator(init.minimal.args, init.gpa);
    defer args.deinit();
    _ = args.next();

    const command = args.next() orelse "web-preview";
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

    if (std.mem.eql(u8, command, "install-url")) {
        try installUrl(init.io, init.gpa, &args);
        return;
    }

    if (std.mem.eql(u8, command, "install-web")) {
        try installWeb(init, &args);
        return;
    }

    if (std.mem.eql(u8, command, "web-preview")) {
        try installWebPreview(init, &args);
        return;
    }

    if (std.mem.eql(u8, command, "rollback")) {
        const root = args.next() orelse return error.MissingInstallRoot;
        try installer.install.rollback(init.io, init.gpa, root);
        return;
    }

    if (std.mem.eql(u8, command, "sign-manifest")) {
        try signManifest(init.io, init.gpa, init.environ_map.*, &args);
        return;
    }

    return error.UnknownCommand;
}

fn printHelp(io: std.Io) !void {
    var buffer: [2048]u8 = undefined;
    var writer = std.Io.File.stdout().writer(io, &buffer);
    try writer.interface.writeAll(
        "Library Setup\n\n" ++
            "Usage:\n" ++
            "  library-setup web-preview [--root <absolute-directory>] [--manifest-url <https-url>] [--no-launch] [--no-shortcuts]\n" ++
            "  library-setup plan [--with-readest] [--with-sioyek]\n" ++
            "  library-setup verify-file <path> <sha256>\n" ++
            "  library-setup install <signed-manifest> --root <absolute-directory> [--ca-cert <absolute-pem>] [--allow-http]\n" ++
            "  library-setup install-url <https-signed-manifest> --root <absolute-directory>\n" ++
            "  library-setup install-web <signed-manifest> --root <absolute-directory> [--allow-http]\n" ++
            "  library-setup rollback <absolute-directory>\n" ++
            "  library-setup sign-manifest <payload> <output> [seed-hex]\n",
    );
    try writer.interface.flush();
}

fn installWeb(init: std.process.Init, args: *std.process.Args.Iterator) !void {
    const manifest_path = args.next() orelse return error.MissingManifest;
    var root: ?[]const u8 = null;
    var allow_http = false;
    while (args.next()) |arg| {
        if (std.mem.eql(u8, arg, "--root")) {
            root = args.next() orelse return error.MissingInstallRoot;
        } else if (std.mem.eql(u8, arg, "--allow-http")) {
            allow_http = true;
        } else return error.UnknownInstallOption;
    }
    const install_root = root orelse return error.MissingInstallRoot;
    const bytes = try std.Io.Dir.cwd().readFileAlloc(init.io, manifest_path, init.gpa, .limited(8 * 1024 * 1024));
    defer init.gpa.free(bytes);
    const signed = try installer.signed_manifest.parse(bytes);
    try installer.verify.verifyManifestSignature(signed.payload, signed.signature_hex, signed.public_key_hex);
    var parsed = try installer.manifest.parse(init.gpa, signed.payload);
    defer parsed.deinit();
    const result = try installer.web_install.install(init.io, init.gpa, &parsed.value, try installer.platform.current(), .{
        .root = install_root,
        .allow_insecure_http = allow_http,
        .environ_map = init.environ_map,
        .create_shortcuts = false,
    });
    result.deinit(init.gpa);
}

fn installWebPreview(init: std.process.Init, args: *std.process.Args.Iterator) !void {
    const target = try installer.platform.current();
    var root: ?[]const u8 = null;
    var manifest_url: []const u8 = web_preview_manifest_url;
    var launch = true;
    var create_shortcuts = true;
    while (args.next()) |arg| {
        if (std.mem.eql(u8, arg, "--root")) {
            root = args.next() orelse return error.MissingInstallRoot;
        } else if (std.mem.eql(u8, arg, "--manifest-url")) {
            manifest_url = args.next() orelse return error.MissingManifestUrl;
        } else if (std.mem.eql(u8, arg, "--no-launch")) {
            launch = false;
        } else if (std.mem.eql(u8, arg, "--no-shortcuts")) {
            create_shortcuts = false;
        } else return error.UnknownInstallOption;
    }

    const owned_root = if (root == null)
        try defaultInstallRoot(init.gpa, target, init.environ_map.*)
    else
        null;
    defer if (owned_root) |value| init.gpa.free(value);
    const install_root = root orelse owned_root.?;
    const cache_dir = try std.fs.path.join(init.gpa, &.{ install_root, "cache" });
    defer init.gpa.free(cache_dir);

    var output_buffer: [1024]u8 = undefined;
    var output = std.Io.File.stdout().writer(init.io, &output_buffer);
    try output.interface.print("Installing Library Web Preview to {s}\n", .{install_root});
    try output.interface.flush();

    const bytes = try installer.download.fetchManifest(init.io, init.gpa, manifest_url, cache_dir);
    defer init.gpa.free(bytes);
    const signed = try installer.signed_manifest.parse(bytes);
    try installer.verify.verifyManifestSignatureTrusted(
        signed.payload,
        signed.signature_hex,
        signed.public_key_hex,
        release_public_key_hex,
    );
    var parsed = try installer.manifest.parse(init.gpa, signed.payload);
    defer parsed.deinit();
    const result = try installer.web_install.install(init.io, init.gpa, &parsed.value, target, .{
        .root = install_root,
        .environ_map = init.environ_map,
        .create_shortcuts = create_shortcuts,
    });
    defer result.deinit(init.gpa);

    try output.interface.print(
        "\nLibrary Web Preview is ready.\nLauncher:\n  {s}\n\n",
        .{result.launcher_path},
    );
    try output.interface.flush();
    if (result.shortcut_path) |shortcut_path| {
        try output.interface.print("Platform launcher:\n  {s}\n\n", .{shortcut_path});
        try output.interface.flush();
    }
    if (launch) {
        try output.interface.writeAll("Starting Library at http://localhost:8080. Close this window to stop it.\n");
        try output.interface.flush();
        var child = try std.process.spawn(init.io, .{ .argv = &.{result.launcher_path} });
        _ = try child.wait(init.io);
    } else {
        try output.interface.writeAll("Run the launcher when you are ready.\n");
        try output.interface.flush();
    }
}

fn defaultInstallRoot(
    allocator: std.mem.Allocator,
    target: installer.platform.Target,
    environ: std.process.Environ.Map,
) ![]u8 {
    return switch (target.os) {
        .windows => std.fs.path.join(allocator, &.{
            environ.get("LOCALAPPDATA") orelse return error.LocalAppDataUnavailable,
            "Library Preview",
        }),
        .macos => std.fs.path.join(allocator, &.{
            environ.get("HOME") orelse return error.HomeDirectoryUnavailable,
            "Library",
            "Application Support",
            "Library Preview",
        }),
        .linux => if (environ.get("XDG_DATA_HOME")) |data_home|
            std.fs.path.join(allocator, &.{ data_home, "library-preview" })
        else
            std.fs.path.join(allocator, &.{
                environ.get("HOME") orelse return error.HomeDirectoryUnavailable,
                ".local",
                "share",
                "library-preview",
            }),
    };
}

fn installUrl(io: std.Io, allocator: std.mem.Allocator, args: *std.process.Args.Iterator) !void {
    const url = args.next() orelse return error.MissingManifestUrl;
    var root: ?[]const u8 = null;
    while (args.next()) |arg| {
        if (std.mem.eql(u8, arg, "--root")) {
            root = args.next() orelse return error.MissingInstallRoot;
        } else return error.UnknownInstallOption;
    }
    const install_root = root orelse return error.MissingInstallRoot;
    const cache_dir = try std.fmt.allocPrint(allocator, "{s}/library/cache", .{install_root});
    defer allocator.free(cache_dir);
    const bytes = try installer.download.fetchManifest(io, allocator, url, cache_dir);
    defer allocator.free(bytes);
    try installManifestBytes(io, allocator, bytes, install_root, null, false);
}

fn signManifest(
    io: std.Io,
    allocator: std.mem.Allocator,
    environ: std.process.Environ.Map,
    args: *std.process.Args.Iterator,
) !void {
    const payload_path = args.next() orelse return error.MissingManifest;
    const output_path = args.next() orelse return error.MissingOutput;
    const seed_hex = args.next() orelse environ.get("LIBRARY_INSTALLER_SIGNING_SEED") orelse return error.MissingSigningSeed;
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
    try installManifestBytes(io, allocator, bytes, install_root, ca_cert, allow_http);
}

fn installManifestBytes(io: std.Io, allocator: std.mem.Allocator, bytes: []const u8, install_root: []const u8, ca_cert: ?[]const u8, allow_http: bool) !void {
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
