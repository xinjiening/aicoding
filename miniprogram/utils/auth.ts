// 角色 / openid 工具

import type { Role, UserInfo } from '../types/event';

export function whoseAddress(role: Role): { wifeWord: string; husbandWord: string; selfWord: string } {
  if (role === 'husband') {
    return { wifeWord: '老婆', husbandWord: '我', selfWord: '我' };
  }
  if (role === 'wife') {
    return { wifeWord: '你', husbandWord: '老公', selfWord: '我' };
  }
  return { wifeWord: '老婆', husbandWord: '老公', selfWord: '我' };
}

/** 「老婆下次大姨妈」 / 「你下次大姨妈」 */
export function nextLine(role: Role): string {
  if (role === 'wife') return '你下次大姨妈';
  return '老婆下次大姨妈';
}

/** 列表里某条事件的 recorder badge 文案：by 我 / by 老公 / by 老婆 */
export function recorderLabel(eventRecorderOpenid: string, me: UserInfo | undefined): string {
  if (!me) return 'by ?';
  if (eventRecorderOpenid === me.openid) return 'by 我';
  if (me.role === 'husband') return 'by 老婆';
  return 'by 老公';
}

export function canSoftDelete(eventRecorderOpenid: string, me: UserInfo | undefined): boolean {
  if (!me) return false;
  return eventRecorderOpenid === me.openid;
}
