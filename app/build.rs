use std::path::{Path, PathBuf};

fn main() {
    println!("cargo:rerun-if-changed=icons/icon.svg");
    generate_icons();
    tauri_build::build();
}

fn icons_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("icons")
}

/// Render `icons/icon.svg` at `size`×`size` and return raw RGBA bytes.
fn render_rgba(size: u32) -> Vec<u8> {
    use resvg::{tiny_skia, usvg};

    let svg = std::fs::read(icons_dir().join("icon.svg"))
        .expect("icons/icon.svg is required — it is the single source for all app icons");

    let tree = usvg::Tree::from_data(&svg, &usvg::Options::default())
        .expect("icons/icon.svg could not be parsed");

    let mut pixmap = tiny_skia::Pixmap::new(size, size)
        .expect("failed to allocate pixmap");

    let sx = size as f32 / tree.size().width();
    let sy = size as f32 / tree.size().height();
    resvg::render(&tree, tiny_skia::Transform::from_scale(sx, sy), &mut pixmap.as_mut());

    pixmap.take()
}

/// Generate all icon formats needed by `tauri.conf.json` from `icon.svg`.
/// Only missing files are (re)generated, so incremental builds are fast.
fn generate_icons() {
    gen_icns();
    gen_ico();
    gen_pngs();
}

// ── macOS: .icns ─────────────────────────────────────────────────────────────

fn gen_icns() {
    let dest = icons_dir().join("icon.icns");

    use icns::{IconFamily, IconType, Image, PixelFormat};

    let mut family = IconFamily::new();

    // (render_pixels, IconType) — pixel count must exactly match the type's
    // declared dimensions. @2x types store double the logical pixels.
    let entries: &[(u32, IconType)] = &[
        (32,   IconType::RGBA32_16x16_2x),
        (32,   IconType::RGBA32_32x32),
        (64,   IconType::RGBA32_32x32_2x),
        (128,  IconType::RGBA32_128x128),
        (256,  IconType::RGBA32_128x128_2x),
        (256,  IconType::RGBA32_256x256),
        (512,  IconType::RGBA32_256x256_2x),
        (1024, IconType::RGBA32_512x512_2x),
    ];

    for &(size, icon_type) in entries {
        let rgba = render_rgba(size);
        let img = Image::from_data(PixelFormat::RGBA, size, size, rgba)
            .expect("failed to create icns image");
        family.add_icon_with_type(&img, icon_type)
            .expect("failed to add entry to icns family");
    }

    let file = std::fs::File::create(&dest).expect("failed to create icon.icns");
    family.write(file).expect("failed to write icon.icns");
    println!("cargo:warning=Generated {}", dest.display());
}

// ── Windows: .ico ─────────────────────────────────────────────────────────────

fn gen_ico() {
    let dest = icons_dir().join("icon.ico");

    let mut dir = ico::IconDir::new(ico::ResourceType::Icon);

    for size in [16u32, 32, 48, 64, 128, 256] {
        let rgba = render_rgba(size);
        let img = ico::IconImage::from_rgba_data(size, size, rgba);
        dir.add_entry(
            ico::IconDirEntry::encode(&img).expect("failed to encode ico entry"),
        );
    }

    let file = std::fs::File::create(&dest).expect("failed to create icon.ico");
    dir.write(file).expect("failed to write icon.ico");
    println!("cargo:warning=Generated {}", dest.display());
}

// ── Linux / generic: plain PNGs ──────────────────────────────────────────────

fn gen_pngs() {
    let dir = icons_dir();

    // 128x128@2x is 256 physical pixels stored under the @2x name convention.
    for (size, name) in [(32u32, "32x32.png"), (128, "128x128.png"), (256, "128x128@2x.png")] {
        let dest = dir.join(name);
        // tiny_skia's Pixmap writes PNG natively — no extra image crate needed.
        let rgba = render_rgba(size);
        let pixmap = resvg::tiny_skia::Pixmap::from_vec(
            rgba,
            resvg::tiny_skia::IntSize::from_wh(size, size).unwrap(),
        )
        .expect("failed to reconstruct pixmap for PNG");
        pixmap.save_png(&dest)
            .expect(&format!("failed to save {name}"));
        println!("cargo:warning=Generated {}", dest.display());
    }
}
