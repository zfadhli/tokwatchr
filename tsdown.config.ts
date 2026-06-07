import { defineConfig } from "tsdown";

export default defineConfig([
	// Library entry — generates .mjs + .d.mts
	{
		entry: ["src/index.ts"],
		format: "esm",
		platform: "node",
		clean: true,
		dts: true,
	},
	// CLI entry — bundled binary (no dts needed)
	{
		entry: {
			"cli/index": "src/cli/index.ts",
		},
		format: "esm",
		platform: "node",
		clean: false,
		dts: false,
	},
]);
