interface OsmTag {
  key: string;
  value: string;
}

function parseTagList(raw: string): OsmTag[] {
  return raw.split(",").map((entry) => {
    const separatorIndex = entry.indexOf("=");
    if (separatorIndex === -1) {
      throw new Error(`parseTagList: malformed tag "${entry}" — expected "key=value"`);
    }
    return {
      key: entry.slice(0, separatorIndex),
      value: entry.slice(separatorIndex + 1),
    };
  });
}

export { parseTagList };
export type { OsmTag };
