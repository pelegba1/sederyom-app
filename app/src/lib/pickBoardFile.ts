/**
 * "לבחור קובץ אקסל": the system's file picker for an exam board, and the file as the server takes it
 * (`ExamBoardPreviewBody.file`): its name, and its content as base64.
 *
 * Only an `.xlsx` file, and at most 1 MB (`boardFileProblem`); both are decided from the name and the size before
 * a single byte of the content is read, so a scan or a huge file never fills the phone's memory. The picker copies
 * the file to the app's cache (`copyToCacheDirectory`), where `expo-file-system` can read it by its `file://` address.
 *
 * The base64 is `File.base64()` of `expo-file-system` (SDK 57), untouched: on Android it is `Base64.NO_WRAP`, on
 * iOS `Data.base64EncodedString()` with no options, so there is no line break in it. The server's decoder is strict
 * (the standard alphabet, padding, no whitespace), and the whitespace stripped below is only so that a different
 * build of the module could not break it.
 *
 * A file that cannot be opened throws; the caller says so (`FILE_UNREADABLE`). Cancelling the picker is `null`. The
 * picker's copy of the file is removed from the cache once it has been read (or refused).
 */
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import { boardFileProblem } from './examBoard';

/** What an `.xlsx` file is, for the picker's filter. */
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export type PickedBoardFile = { name: string; base64: string };

/** The file picked, `null` when the person cancelled, or why it will not do (nothing of it was read). */
export async function pickBoardFile(): Promise<PickedBoardFile | null | 'too_big' | 'unsupported'> {
  // Android's picker filters by the type a file's provider reports, and some (file managers, saved attachments) report a
  // real .xlsx as an Excel file of the old kind or as bytes with no type: those are offered too, and the name and the size
  // decide after the pick (`boardFileProblem`).
  const type = [XLSX_MIME, 'application/vnd.ms-excel', 'application/octet-stream'];
  const picked = await DocumentPicker.getDocumentAsync({ type, copyToCacheDirectory: true, multiple: false });
  const asset = picked.canceled ? undefined : picked.assets[0];
  if (!asset) return null;

  const file = new File(asset.uri);
  try {
    // The picker does not always know the size; the copy in the cache does.
    const size = asset.size ?? file.size;
    const problem = boardFileProblem(asset.name, size);
    if (problem) return problem;

    const base64 = (await file.base64()).replace(/\s+/g, '');
    return { name: asset.name, base64 };
  } finally {
    // The copy the picker made is ours and the content is on its way to the server: it is not kept. The file the
    // person picked is never touched, so only a file inside the app's own cache is removed.
    try {
      if (asset.uri.startsWith(Paths.cache.uri)) file.delete();
    } catch {
      // The system clears the cache itself.
    }
  }
}
