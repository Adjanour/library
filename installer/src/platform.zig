const builtin = @import("builtin");
const manifest = @import("manifest.zig");

pub const Target = struct {
    os: manifest.Os,
    arch: manifest.Arch,
};

pub fn current() !Target {
    return .{
        .os = switch (builtin.os.tag) {
            .linux => .linux,
            .macos => .macos,
            .windows => .windows,
            else => return error.UnsupportedOperatingSystem,
        },
        .arch = switch (builtin.cpu.arch) {
            .x86_64 => .x86_64,
            .aarch64 => .aarch64,
            else => return error.UnsupportedArchitecture,
        },
    };
}
