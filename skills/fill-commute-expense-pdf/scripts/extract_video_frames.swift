import AppKit
import AVFoundation
import CryptoKit
import Foundation

struct FrameRecord: Codable {
    let file: String
    let requested_seconds: Double
    let actual_seconds: Double
}

struct VideoManifest: Codable {
    let source_video: String
    let source_sha256: String
    let duration_seconds: Double
    let interval_seconds: Double
    let frame_count: Int
    let width: Int
    let height: Int
    let frames: [FrameRecord]
    let extractor: String
}

enum ExtractError: Error, CustomStringConvertible {
    case usage
    case invalidArgument(String)
    case unreadableVideo(String)
    case imageEncoding(String)

    var description: String {
        switch self {
        case .usage:
            return "Usage: extract_video_frames.swift INPUT OUTPUT_DIR INTERVAL MAX_FRAMES"
        case .invalidArgument(let message), .unreadableVideo(let message), .imageEncoding(let message):
            return message
        }
    }
}

func sha256File(_ url: URL) throws -> String {
    let handle = try FileHandle(forReadingFrom: url)
    defer { try? handle.close() }
    var digest = SHA256()
    while true {
        let data = try handle.read(upToCount: 1024 * 1024) ?? Data()
        if data.isEmpty { break }
        digest.update(data: data)
    }
    return digest.finalize().map { String(format: "%02x", $0) }.joined()
}

@main
struct ExtractVideoFrames {
    static func main() async {
        do {
            try await run()
        } catch {
            fputs("ERROR: \(error)\n", stderr)
            Foundation.exit(2)
        }
    }

    static func run() async throws {
        let arguments = CommandLine.arguments
        guard arguments.count == 5 else { throw ExtractError.usage }
        let inputURL = URL(fileURLWithPath: arguments[1]).standardizedFileURL
        let outputURL = URL(fileURLWithPath: arguments[2]).standardizedFileURL
        guard let interval = Double(arguments[3]), interval > 0 else {
            throw ExtractError.invalidArgument("INTERVAL must be greater than zero")
        }
        guard let maxFrames = Int(arguments[4]), maxFrames > 0 else {
            throw ExtractError.invalidArgument("MAX_FRAMES must be positive")
        }

        let asset = AVURLAsset(url: inputURL)
        let durationTime = try await asset.load(.duration)
        let duration = CMTimeGetSeconds(durationTime)
        guard duration.isFinite, duration > 0 else {
            throw ExtractError.unreadableVideo("Could not read a positive video duration")
        }
        let estimatedFrames = Int(floor(duration / interval)) + 1
        guard estimatedFrames <= maxFrames else {
            throw ExtractError.invalidArgument(
                "Video would create about \(estimatedFrames) frames; increase interval or max frames"
            )
        }

        let generator = AVAssetImageGenerator(asset: asset)
        generator.appliesPreferredTrackTransform = true
        generator.requestedTimeToleranceBefore = .zero
        generator.requestedTimeToleranceAfter = .zero

        var records: [FrameRecord] = []
        var pixelWidth = 0
        var pixelHeight = 0
        for index in 0..<estimatedFrames {
            let requested = min(Double(index) * interval, max(duration - 0.001, 0))
            let requestedTime = CMTime(seconds: requested, preferredTimescale: 600)
            let (image, actualTime) = try await generator.image(at: requestedTime)
            pixelWidth = image.width
            pixelHeight = image.height
            let fileName = String(format: "frame-%06d.png", index + 1)
            let fileURL = outputURL.appendingPathComponent(fileName)
            let bitmap = NSBitmapImageRep(cgImage: image)
            guard let png = bitmap.representation(using: .png, properties: [:]) else {
                throw ExtractError.imageEncoding("Could not encode \(fileName) as PNG")
            }
            try png.write(to: fileURL, options: .atomic)
            records.append(
                FrameRecord(
                    file: fileName,
                    requested_seconds: requested,
                    actual_seconds: CMTimeGetSeconds(actualTime)
                )
            )
        }

        let manifest = VideoManifest(
            source_video: inputURL.path,
            source_sha256: try sha256File(inputURL),
            duration_seconds: duration,
            interval_seconds: interval,
            frame_count: records.count,
            width: pixelWidth,
            height: pixelHeight,
            frames: records,
            extractor: "macos-avfoundation"
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        let encoded = try encoder.encode(manifest)
        try encoded.write(to: outputURL.appendingPathComponent("manifest.json"), options: .atomic)
    }
}
