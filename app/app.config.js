const fs = require('node:fs');
const path = require('node:path');

module.exports = ({ config }) => {
  // EAS file variables resolve to an uploaded file's path on the build worker.
  // Local builds can instead use app/google-services.json.
  const localFile = path.join(__dirname, 'google-services.json');
  const googleServicesFile = process.env.GOOGLE_SERVICES_JSON ||
    (fs.existsSync(localFile) ? localFile : undefined);
  return {
    ...config,
    android: {
      ...config.android,
      ...(googleServicesFile ? { googleServicesFile } : {}),
    },
  };
};
