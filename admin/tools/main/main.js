"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main/resources/admin/tools/main/main.ts
var main_exports = {};
__export(main_exports, {
  get: () => get
});
module.exports = __toCommonJS(main_exports);
var import_admin = require("/lib/xp/admin");
var import_mustache = require("/lib/mustache");
var import_portal = require("/lib/xp/portal");
function get(req) {
  const view = resolve("./main.html");
  const params = {
    assetsUri: (0, import_portal.assetUrl)({ path: "" }),
    launcherPath: (0, import_admin.getLauncherPath)(),
    toolUrl: (0, import_admin.getToolUrl)(app.name, "main"),
    adminUrl: (0, import_admin.getBaseUri)()
  };
  return {
    contentType: "text/html",
    body: (0, import_mustache.render)(view, params)
  };
}
