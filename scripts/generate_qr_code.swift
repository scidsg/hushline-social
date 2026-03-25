import AppKit
import CoreImage
import Foundation

guard CommandLine.arguments.count >= 3 else {
  fputs("Usage: swift scripts/generate_qr_code.swift <text> <output-path> [size]\n", stderr)
  exit(1)
}

let text = CommandLine.arguments[1]
let outputPath = CommandLine.arguments[2]
let size = CommandLine.arguments.count >= 4 ? Int(CommandLine.arguments[3]) ?? 720 : 720

guard let data = text.data(using: .utf8) else {
  fputs("Failed to encode QR payload.\n", stderr)
  exit(1)
}

guard let filter = CIFilter(name: "CIQRCodeGenerator") else {
  fputs("CIQRCodeGenerator is unavailable.\n", stderr)
  exit(1)
}

filter.setValue(data, forKey: "inputMessage")
filter.setValue("M", forKey: "inputCorrectionLevel")

guard let outputImage = filter.outputImage else {
  fputs("Failed to generate QR image.\n", stderr)
  exit(1)
}

let extent = outputImage.extent.integral
let representation = NSCIImageRep(ciImage: outputImage)
let qrImage = NSImage(size: representation.size)
qrImage.addRepresentation(representation)

let scaledSize = NSSize(width: size, height: size)
let scaledImage = NSImage(size: scaledSize)

scaledImage.lockFocus()
guard let graphicsContext = NSGraphicsContext.current else {
  fputs("Failed to access graphics context for QR image.\n", stderr)
  exit(1)
}
graphicsContext.imageInterpolation = .none
NSColor.white.setFill()
NSBezierPath(rect: NSRect(origin: .zero, size: scaledSize)).fill()
qrImage.draw(
  in: NSRect(origin: .zero, size: scaledSize),
  from: NSRect(origin: .zero, size: extent.size),
  operation: .copy,
  fraction: 1.0
)
scaledImage.unlockFocus()

guard
  let tiffRepresentation = scaledImage.tiffRepresentation,
  let bitmap = NSBitmapImageRep(data: tiffRepresentation),
  let pngData = bitmap.representation(using: .png, properties: [:])
else {
  fputs("Failed to encode QR code PNG.\n", stderr)
  exit(1)
}

do {
  try pngData.write(to: URL(fileURLWithPath: outputPath))
} catch {
  fputs("Failed to write QR code image.\n", stderr)
  exit(1)
}
