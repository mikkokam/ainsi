// @hutch cli=0.26.0 cottontail=0.6.0
export default {
	scripts: {
		install: ["hutch", "install", "--frozen-lockfile"],
		start: ["hutch", "electrobun", "dev"],
		dev: ["hutch", "electrobun", "dev", "--watch"],
		build: ["hutch", "electrobun", "build", "--env=stable"],
	},
	electrobun: {
		version: "2.0.2-beta.17",
	},
};
