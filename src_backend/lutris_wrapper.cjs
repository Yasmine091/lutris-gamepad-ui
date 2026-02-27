const { execPromise, logError, getLutrisWrapperPath } = require("./utils.cjs");

const SUBCOMMAND_OUTPUT_HEADER = "lutris-subcommand-output:";

async function invokeLutrisSubcommand(subcommandName, args = []) {
  try {
    const { stdout } = await invokeLutris(["--" + subcommandName, ...args]);

    const outputLine = stdout
      .split(/\r?\n/)
      .find((line) => line.startsWith(SUBCOMMAND_OUTPUT_HEADER));

    if (outputLine) {
      const jsonString = outputLine.substring(SUBCOMMAND_OUTPUT_HEADER.length);
      return JSON.parse(jsonString);
    } else {
      throw new Error(`Output header not found`);
    }
  } catch (error) {
    logError(
      "failed to execute lutris wrapper subcommand",
      subcommandName,
      args,
      error
    );
    throw error;
  }
}

async function invokeLutris(args = []) {
  const serializedArgs = args.map((arg) => JSON.stringify(String(arg))).join(" ");
  return await execPromise(
    `bash "${getLutrisWrapperPath()}" ${serializedArgs}`.trim()
  );
}

async function getCoverartPath() {
  return await invokeLutrisSubcommand("get-coverart-path");
}

async function getBannerartPath() {
  return await invokeLutrisSubcommand("get-bannerart-path");
}

async function getRuntimeIconPath(iconName) {
  return await invokeLutrisSubcommand("get-runtime-icon-path", [iconName]);
}

async function getAllGamesCategories() {
  return await invokeLutrisSubcommand("get-all-games-categories");
}

async function getLutrisGames() {
  return await invokeLutrisSubcommand("list-games");
}

module.exports = {
  getCoverartPath,
  getBannerartPath,
  getRuntimeIconPath,
  getAllGamesCategories,
  getLutrisGames,
  invokeLutris,
};
