import AppKit
import Foundation

guard CommandLine.arguments.count == 3 else {
    fputs("Usage: make-icon.swift <input-png> <output-icns>\n", stderr)
    exit(1)
}

let inputURL = URL(fileURLWithPath: CommandLine.arguments[1])
let outputICNS = URL(fileURLWithPath: CommandLine.arguments[2])

guard let sourceImage = NSImage(contentsOf: inputURL) else {
    fputs("Failed to load source icon at \(inputURL.path)\n", stderr)
    exit(1)
}

try FileManager.default.createDirectory(
    at: outputICNS.deletingLastPathComponent(),
    withIntermediateDirectories: true
)

func renderIcon(pixelSize: Int) throws -> Data {
    let size = CGFloat(pixelSize)
    guard let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil,
        pixelsWide: pixelSize,
        pixelsHigh: pixelSize,
        bitsPerSample: 8,
        samplesPerPixel: 4,
        hasAlpha: true,
        isPlanar: false,
        colorSpaceName: .deviceRGB,
        bytesPerRow: 0,
        bitsPerPixel: 0
    ) else {
        throw NSError(domain: "MakeIcon", code: 1, userInfo: [NSLocalizedDescriptionKey: "Failed to allocate bitmap"])
    }

    rep.size = NSSize(width: size, height: size)
    guard let ctx = NSGraphicsContext(bitmapImageRep: rep) else {
        throw NSError(domain: "MakeIcon", code: 2, userInfo: [NSLocalizedDescriptionKey: "Failed to create graphics context"])
    }

    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = ctx
    ctx.imageInterpolation = .high
    ctx.shouldAntialias = true

    NSColor.clear.setFill()
    NSRect(x: 0, y: 0, width: size, height: size).fill()

    // Standard macOS rounded-square tile proportions (~80.5% of canvas, 22.5% corner radius).
    let inset = size * 0.0975
    let tileRect = NSRect(x: inset, y: inset, width: size - inset * 2, height: size - inset * 2)
    let cornerRadius = tileRect.width * 0.225
    let tilePath = NSBezierPath(roundedRect: tileRect, xRadius: cornerRadius, yRadius: cornerRadius)

    let shadow = NSShadow()
    shadow.shadowOffset = NSSize(width: 0, height: -size * 0.015)
    shadow.shadowBlurRadius = size * 0.03
    shadow.shadowColor = NSColor(calibratedWhite: 0, alpha: 0.22)

    ctx.saveGraphicsState()
    shadow.set()
    NSColor.white.setFill()
    tilePath.fill()
    ctx.restoreGraphicsState()

    ctx.saveGraphicsState()
    tilePath.addClip()
    let gradient = NSGradient(
        starting: NSColor(calibratedRed: 0.965, green: 0.968, blue: 0.992, alpha: 1.0),
        ending: NSColor(calibratedRed: 1.0, green: 1.0, blue: 1.0, alpha: 1.0)
    )
    gradient?.draw(in: tileRect, angle: 90)

    let logoPadding = tileRect.width * 0.165
    let logoRect = tileRect.insetBy(dx: logoPadding, dy: logoPadding)
    sourceImage.draw(in: logoRect, from: .zero, operation: .sourceOver, fraction: 1.0)
    ctx.restoreGraphicsState()

    NSColor(calibratedWhite: 0.0, alpha: 0.08).setStroke()
    tilePath.lineWidth = max(1.0, size * 0.004)
    tilePath.stroke()

    NSGraphicsContext.restoreGraphicsState()

    guard let pngData = rep.representation(using: .png, properties: [:]) else {
        throw NSError(domain: "MakeIcon", code: 3, userInfo: [NSLocalizedDescriptionKey: "Failed to encode PNG"])
    }
    return pngData
}

func appendUInt32BE(_ value: UInt32, to data: inout Data) {
    var be = value.bigEndian
    withUnsafeBytes(of: &be) { data.append(contentsOf: $0) }
}

// Apple ICNS PNG chunk types supported by macOS Finder/Dock/Spotlight.
let icnsEntries: [(osType: String, pixels: Int)] = [
    ("icp4", 16),   // 16x16
    ("icp5", 32),   // 32x32
    ("icp6", 64),   // 64x64
    ("ic07", 128),  // 128x128
    ("ic11", 32),   // 16x16@2x
    ("ic12", 64),   // 32x32@2x
    ("ic08", 256),  // 256x256
    ("ic13", 256),  // 128x128@2x
    ("ic09", 512),  // 512x512
    ("ic14", 512),  // 256x256@2x
    ("ic10", 1024), // 512x512@2x
]

var pngBySize: [Int: Data] = [:]
for size in Set(icnsEntries.map(\.pixels)) {
    pngBySize[size] = try renderIcon(pixelSize: size)
}

var body = Data()
for entry in icnsEntries {
    guard let png = pngBySize[entry.pixels],
          let tagData = entry.osType.data(using: .ascii),
          tagData.count == 4
    else { continue }
    body.append(tagData)
    appendUInt32BE(UInt32(8 + png.count), to: &body)
    body.append(png)
}

var icnsData = Data("icns".utf8)
appendUInt32BE(UInt32(8 + body.count), to: &icnsData)
icnsData.append(body)

try icnsData.write(to: outputICNS)
