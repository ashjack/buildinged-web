export const LOCAL_FILE_SNAPSHOT_VERSION = 1;

export async function copyLocalBlob(blob: Blob, name: string): Promise<Blob> {
  try {
    // File-backed blobs can become unreadable if the source file moves or changes.
    const bytes = await blob.arrayBuffer();
    if (bytes.byteLength !== blob.size) throw new Error('The file was not read completely.');
    return new Blob([bytes], { type: blob.type });
  } catch (error) {
    throw new Error(`Could not read "${name}" for browser storage: ${error instanceof Error ? error.message : String(error)}`);
  }
}
