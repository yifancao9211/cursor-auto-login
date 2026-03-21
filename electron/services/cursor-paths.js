import path from "node:path";
import os from "node:os";

export function getCursorDataDir() {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Cursor");
  } else if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Cursor");
  } else {
    return path.join(os.homedir(), ".config", "Cursor");
  }
}
