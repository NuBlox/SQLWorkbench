import adapter from "@sveltejs/adapter-static";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: adapter({
      pages: "build/renderer",
      assets: "build/renderer",
      fallback: "index.html",
    }),
    paths: {
      relative: true,
    },
  },
};

export default config;
