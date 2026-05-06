// ping 云函数：仅用于保活容器，避免冷启动慢
exports.main = async () => {
  return { ok: true, data: { ts: Date.now() } };
};
