import { createBabelDocEngine } from "./engine.babeldoc.js";

export function createEngineAdapter() {
  const babeldoc = createBabelDocEngine();

  return {
    async translatePdf({ inputBuffer, sourceLang, targetLang, options = {} }) {
      return babeldoc.translatePdf({
        inputBuffer,
        sourceLang,
        targetLang,
        options
      });
    }
  };
}

