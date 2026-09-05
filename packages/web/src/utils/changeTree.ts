import type { FileStatus } from '@/api/types';

export interface ChangeTreeNode {
  key: string;
  label: string;
  /** 目录前缀或文件完整路径（git 风格 /） */
  fullPath: string;
  fileCount: number;
  file?: FileStatus;
  children?: ChangeTreeNode[];
}

/** 把扁平 git 路径列表建成目录树：目录在前、同级按名称排。 */
export function buildChangeTree(files: FileStatus[]): ChangeTreeNode[] {
  const roots: ChangeTreeNode[] = [];

  for (const file of files) {
    const parts = file.path.split(/[/\\]/).filter((p) => p.length > 0);
    if (parts.length === 0) continue;
    let level = roots;
    let prefix = '';
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      prefix = prefix ? `${prefix}/${part}` : part;
      const isFile = i === parts.length - 1;
      if (isFile) {
        level.push({
          key: `file:${file.path}`,
          label: part,
          fullPath: file.path,
          fileCount: 1,
          file
        });
        continue;
      }
      let node = level.find((n) => !n.file && n.label === part);
      if (!node) {
        node = {
          key: `dir:${prefix}`,
          label: part,
          fullPath: prefix,
          fileCount: 0,
          children: []
        };
        level.push(node);
      }
      node.children ??= [];
      level = node.children;
    }
  }

  const sortLevel = (nodes: ChangeTreeNode[]): void => {
    nodes.sort((a, b) => {
      const ad = a.file ? 1 : 0;
      const bd = b.file ? 1 : 0;
      if (ad !== bd) return ad - bd;
      return a.label.localeCompare(b.label);
    });
    for (const n of nodes) {
      if (n.children) {
        sortLevel(n.children);
        n.fileCount = n.children.reduce((s, c) => s + c.fileCount, 0);
      }
    }
  };
  sortLevel(roots);
  return roots;
}

export function treeFilePaths(node: ChangeTreeNode): string[] {
  if (node.file) return [node.file.path];
  return (node.children ?? []).flatMap(treeFilePaths);
}
