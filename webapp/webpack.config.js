const path = require("path");
const { WebpackManifestPlugin } = require("webpack-manifest-plugin");
const WebpackShellPluginNext = require("webpack-shell-plugin-next");

module.exports = (env, argv) => {
  const isProd = argv && argv.mode === "production";
  const isCI = process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";

  const plugins = [
    new WebpackManifestPlugin({
      fileName: path.resolve(
        __dirname,
        "../omero_biomero/static/omero_biomero/assets/asset-manifest.json"
      ),
      publicPath: "/omero_biomero/assets/",
    }),
  ];

  // Only run shell hooks in local dev/watch. Skip in production/CI builds.
  if (!isProd && !isCI) {
    plugins.push(
      new WebpackShellPluginNext({
        onAfterDone: {
          scripts: ["bash ../omero-update.sh"], // Local dev convenience
          blocking: false,
          parallel: false,
        },
        onBeforeCompile: {
          scripts: [
            "rimraf ../omero_biomero/static/omero_biomero/assets",
            "echo 'Cleaning up'",
          ],
        },
      })
    );
  }

  return {
    devtool: "source-map",
    entry: "./src/index.js",
    output: {
      path: path.resolve(
        __dirname,
        "../omero_biomero/static/omero_biomero/assets/"
      ),
      filename: "main.[contenthash].js",
    },
    mode: (argv && argv.mode) || "development",
    plugins,
    module: {
    rules: [
      {
        test: /\.(js|jsx)$/, // Match both .js and .jsx files
        exclude: /node_modules/, // Exclude node_modules directory
        use: {
          loader: "babel-loader", // Use Babel to transpile JavaScript
        },
      },
      {
        test: /\.css$/,
        use: [
          "style-loader", // Injects styles into DOM
          "css-loader", // Resolves @import and url()
          {
            loader: "postcss-loader", // Processes Tailwind CSS
            options: {
              postcssOptions: {
                plugins: [require("tailwindcss"), require("autoprefixer")],
              },
            },
          },
        ],
      },
      {
        test: /\.svg$/,
        use: ["file-loader"], // Handle .svg as static files
      },
    ],
    },
    resolve: {
      extensions: [".js", ".jsx"], // Automatically resolve these extensions
    },
  };
};
