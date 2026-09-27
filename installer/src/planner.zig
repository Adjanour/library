const manifest = @import("manifest.zig");
const platform = @import("platform.zig");

pub const Selection = struct {
    readest: bool = false,
    sioyek: bool = false,

    pub fn includes(self: Selection, id: manifest.PackageId) bool {
        return switch (id) {
            .library => true,
            .library_desktop => false,
            .web_preview, .deno => false,
            .readest => self.readest,
            .sioyek => self.sioyek,
        };
    }
};

pub const Item = struct {
    package: *const manifest.Package,
    artifact: *const manifest.Artifact,
};

pub const Plan = struct {
    items: [3]Item = undefined,
    len: usize = 0,

    pub fn slice(self: *const Plan) []const Item {
        return self.items[0..self.len];
    }
};

pub fn create(
    release: *const manifest.Manifest,
    target: platform.Target,
    selection: Selection,
) !Plan {
    var plan: Plan = .{};
    var library_seen = false;
    for (release.packages) |*package| {
        if (!selection.includes(package.id)) continue;
        const artifact = findArtifact(package, target) orelse return error.ArtifactUnavailable;
        if (package.id == .library) library_seen = true;
        plan.items[plan.len] = .{ .package = package, .artifact = artifact };
        plan.len += 1;
    }
    if (!library_seen) return error.LibraryPackageMissing;
    return plan;
}

pub fn findArtifact(package: *const manifest.Package, target: platform.Target) ?*const manifest.Artifact {
    for (package.artifacts) |*artifact| {
        if (artifact.os == target.os and artifact.arch == target.arch) return artifact;
    }
    return null;
}

pub fn findPackageArtifact(release: *const manifest.Manifest, id: manifest.PackageId, target: platform.Target) !Item {
    for (release.packages) |*package| {
        if (package.id != id) continue;
        return .{
            .package = package,
            .artifact = findArtifact(package, target) orelse return error.ArtifactUnavailable,
        };
    }
    return error.PackageMissing;
}
