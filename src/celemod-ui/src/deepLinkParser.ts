const PREFIX = "celemod://";
const INSTALL_MOD_PREFIX = "install_mod/";
const ADD_PROFILE_PREFIX = "add_profile/";

export type CeleModDeepLink =
  | { type: "install_mod"; value: string }
  | { type: "add_profile"; value: string };

const decodePayload = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

export const parseCeleModDeepLink = (raw: string): CeleModDeepLink => {
  if (!raw.toLocaleLowerCase().startsWith(PREFIX))
    throw new Error("不支持的链接协议");
  const command = raw.slice(PREFIX.length).replace(/^\/+/, "");

  if (command.toLocaleLowerCase().startsWith(INSTALL_MOD_PREFIX)) {
    const value = decodePayload(
      command.slice(INSTALL_MOD_PREFIX.length)
    ).trim();
    if (!value) throw new Error("安装链接缺少 Mod 标识");
    return { type: "install_mod", value };
  }

  if (command.toLocaleLowerCase().startsWith(ADD_PROFILE_PREFIX)) {
    const value = decodePayload(
      command.slice(ADD_PROFILE_PREFIX.length)
    ).trim();
    if (!value) throw new Error("配置链接缺少 Profile JSON");
    JSON.parse(value);
    return { type: "add_profile", value };
  }

  throw new Error("不支持的 CeleMod 链接操作");
};
