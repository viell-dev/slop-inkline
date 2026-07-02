export interface EditorPosition {
  line: number;
  ch: number;
}

export interface Editor {
  getCursor(): EditorPosition;
  getLine(line: number): string;
}

export class TAbstractFile {
  constructor(
    public path: string,
    public name: string,
    public parent: TFolder | null = null,
  ) {}
}

export class TFile extends TAbstractFile {
  constructor(
    path: string,
    name: string,
    parent: TFolder | null = null,
    public basename = name.replace(/\.[^.]+$/, ""),
    public extension = name.includes(".") ? name.split(".").pop() ?? "" : "",
  ) {
    super(path, name, parent);
  }
}

export class TFolder extends TAbstractFile {
  children: TAbstractFile[] = [];

  isRoot(): boolean {
    return this.path === "";
  }
}

export interface Vault {
  getFiles(): TFile[];
  getAbstractFileByPath(path: string): TAbstractFile | null;
  getFolderByPath(path: string): TFolder | null;
  getFileByPath(path: string): TFile | null;
  createBinary(path: string, data: ArrayBuffer): Promise<TFile>;
  readBinary(file: TFile): Promise<ArrayBuffer>;
  modifyBinary(file: TFile, data: ArrayBuffer): Promise<void>;
  delete(file: TFile): Promise<void>;
  createFolder(path: string): Promise<TFolder>;
}

export interface FileManager {
  getAvailablePathForAttachment(filename: string, sourcePath: string): Promise<string>;
  renameFile(file: TFile, newPath: string): Promise<void>;
}

export interface App {
  vault: Vault;
  fileManager: FileManager;
}

export function normalizePath(path: string): string {
  return path
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "");
}
