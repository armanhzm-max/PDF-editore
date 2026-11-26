const DEFAULT_ERRORS = {
    invalid: "zip_invalid",
    tooLarge: "zip_too_large",
    tooManyEntries: "zip_too_many_entries",
    zip64: "zip64_unsupported",
};
const MAX_ENTRIES = 5_000;
export function inspectZipArchive(bytes, maxUncompressedBytes, errors = DEFAULT_ERRORS, maxEntries = MAX_ENTRIES) {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength < 22 || !Number.isSafeInteger(maxUncompressedBytes) || maxUncompressedBytes < 1) {
        throw new Error(errors.invalid);
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const min = Math.max(0, bytes.byteLength - 65_557);
    let eocd = -1;
    for (let offset = bytes.byteLength - 22; offset >= min; offset -= 1) {
        if (view.getUint32(offset, true) === 0x06054b50) {
            eocd = offset;
            break;
        }
    }
    if (eocd < 0 || eocd + 22 > bytes.byteLength)
        throw new Error(errors.invalid);
    const diskNumber = view.getUint16(eocd + 4, true);
    const centralDisk = view.getUint16(eocd + 6, true);
    const entriesOnDisk = view.getUint16(eocd + 8, true);
    const entries = view.getUint16(eocd + 10, true);
    const directorySize = view.getUint32(eocd + 12, true);
    const directoryOffset = view.getUint32(eocd + 16, true);
    const commentLength = view.getUint16(eocd + 20, true);
    if (eocd + 22 + commentLength !== bytes.byteLength || diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== entries) {
        throw new Error(errors.invalid);
    }
    if (entries === 0xffff || directoryOffset === 0xffffffff || directorySize === 0xffffffff)
        throw new Error(errors.zip64);
    if (entries < 1 || entries > maxEntries)
        throw new Error(errors.tooManyEntries);
    const directoryEnd = directoryOffset + directorySize;
    if (!Number.isSafeInteger(directoryEnd) || directoryOffset < 0 || directoryEnd > eocd || directoryOffset > bytes.byteLength) {
        throw new Error(errors.invalid);
    }
    const decoder = new TextDecoder("utf-8");
    const seen = new Set();
    const localRanges = [];
    let cursor = directoryOffset;
    let total = 0;
    for (let index = 0; index < entries; index += 1) {
        if (cursor + 46 > directoryEnd || view.getUint32(cursor, true) !== 0x02014b50)
            throw new Error(errors.invalid);
        const flags = view.getUint16(cursor + 8, true);
        const method = view.getUint16(cursor + 10, true);
        const expectedCrc = view.getUint32(cursor + 16, true);
        const compressed = view.getUint32(cursor + 20, true);
        const uncompressed = view.getUint32(cursor + 24, true);
        const nameLength = view.getUint16(cursor + 28, true);
        const extraLength = view.getUint16(cursor + 30, true);
        const fileCommentLength = view.getUint16(cursor + 32, true);
        const localOffset = view.getUint32(cursor + 42, true);
        const next = cursor + 46 + nameLength + extraLength + fileCommentLength;
        const supportedFlags = 0x0800 | 0x0008 | 0x0006; // UTF-8 names, data descriptor, deflate tuning bits.
        if (next > directoryEnd || (flags & 0x0001) !== 0 || (flags & ~supportedFlags) !== 0 || (method !== 0 && method !== 8))
            throw new Error(errors.invalid);
        if (compressed === 0xffffffff || uncompressed === 0xffffffff || localOffset === 0xffffffff)
            throw new Error(errors.zip64);
        const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
        if (!name || name.includes("\0") || name.includes("\\") || name.startsWith("/") || /^[a-zA-Z]:/.test(name)
            || name.split("/").some((part) => part === "..") || seen.has(name)) {
            throw new Error(errors.invalid);
        }
        seen.add(name);
        total += uncompressed;
        if (!Number.isSafeInteger(total) || total > maxUncompressedBytes)
            throw new Error(errors.tooLarge);
        // Validate the local header and payload range before handing bytes to the ZIP decoder.
        if (localOffset + 30 > directoryOffset || view.getUint32(localOffset, true) !== 0x04034b50)
            throw new Error(errors.invalid);
        const localFlags = view.getUint16(localOffset + 6, true);
        const localMethod = view.getUint16(localOffset + 8, true);
        const localCrc = view.getUint32(localOffset + 14, true);
        const localCompressed = view.getUint32(localOffset + 18, true);
        const localUncompressed = view.getUint32(localOffset + 22, true);
        const localNameLength = view.getUint16(localOffset + 26, true);
        const localExtraLength = view.getUint16(localOffset + 28, true);
        if ((localFlags & 0x0001) !== 0 || localFlags !== flags || localMethod !== method)
            throw new Error(errors.invalid);
        const dataStart = localOffset + 30 + localNameLength + localExtraLength;
        const dataEnd = dataStart + compressed;
        if (dataStart > directoryOffset || dataEnd > directoryOffset || dataEnd < dataStart)
            throw new Error(errors.invalid);
        const localName = decoder.decode(bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength));
        if (localName !== name)
            throw new Error(errors.invalid);
        let rangeEnd = dataEnd;
        if ((flags & 0x0008) !== 0) {
            // Data descriptors may include the optional 0x08074b50 signature.
            let descriptor = dataEnd;
            if (descriptor + 4 <= directoryOffset && view.getUint32(descriptor, true) === 0x08074b50)
                descriptor += 4;
            if (descriptor + 12 > directoryOffset
                || view.getUint32(descriptor, true) !== expectedCrc
                || view.getUint32(descriptor + 4, true) !== compressed
                || view.getUint32(descriptor + 8, true) !== uncompressed)
                throw new Error(errors.invalid);
            rangeEnd = descriptor + 12;
        }
        else if (localCrc !== expectedCrc || localCompressed !== compressed || localUncompressed !== uncompressed) {
            throw new Error(errors.invalid);
        }
        localRanges.push({ start: localOffset, end: rangeEnd });
        cursor = next;
    }
    if (cursor !== directoryEnd)
        throw new Error(errors.invalid);
    localRanges.sort((a, b) => a.start - b.start);
    for (let index = 1; index < localRanges.length; index += 1) {
        if (localRanges[index].start < localRanges[index - 1].end)
            throw new Error(errors.invalid);
    }
    return total;
}
