const path = require('path');

module.exports = {
  webpack: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
    // Plan 7 follow-up — Excalidraw 0.18+ ships ESM with extensionless
    // imports (e.g. `roughjs/bin/rough`). Webpack 5 treats ESM as "fully
    // specified" by default, which rejects extensionless imports. Relax the
    // rule for .js files so Excalidraw's ESM bundle resolves.
    configure: (webpackConfig) => {
      webpackConfig.module.rules.push({
        test: /\.m?js$/,
        resolve: { fullySpecified: false },
      });

      // Silence missing-source-map warnings from third-party packages that
      // ship pre-built bundles referencing .ts source files which aren't
      // included in the published tarball (Excalidraw + dompurify). The
      // bundles themselves work fine; only the source-maps are missing.
      const ignoreWarnings = webpackConfig.ignoreWarnings || [];
      ignoreWarnings.push(/Failed to parse source map/);
      webpackConfig.ignoreWarnings = ignoreWarnings;

      // Belt-and-suspenders: also exclude these packages from
      // source-map-loader so the warning never reaches webpack.
      for (const rule of webpackConfig.module.rules) {
        if (!Array.isArray(rule.oneOf)) continue;
        for (const oneOfRule of rule.oneOf) {
          if (!oneOfRule.use) continue;
          const uses = Array.isArray(oneOfRule.use) ? oneOfRule.use : [oneOfRule.use];
          for (const use of uses) {
            if (use && use.loader && use.loader.includes('source-map-loader')) {
              oneOfRule.exclude = [
                ...(Array.isArray(oneOfRule.exclude) ? oneOfRule.exclude : oneOfRule.exclude ? [oneOfRule.exclude] : []),
                /node_modules[\\/]@excalidraw/,
                /node_modules[\\/]dompurify/,
              ];
            }
          }
        }
      }

      return webpackConfig;
    },
  },
  jest: {
    configure: {
      moduleNameMapper: {
        '^@shared/(.*)$': '<rootDir>/src/shared/$1',
        '^react-router-dom$':
          '<rootDir>/node_modules/react-router-dom/dist/index.js',
        '^react-router/dom$':
          '<rootDir>/node_modules/react-router/dist/development/dom-export.js',
        '^react-router$':
          '<rootDir>/node_modules/react-router/dist/development/index.js',
      },
    },
  },
};
