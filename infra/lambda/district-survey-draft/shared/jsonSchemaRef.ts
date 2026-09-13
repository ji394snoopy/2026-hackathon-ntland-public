function ref(defName: string): { $ref: string } {
  return { $ref: `#/$defs/${defName}` };
}

export { ref };
