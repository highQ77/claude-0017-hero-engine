/**
 * ai 模組的資源鍵（不包含其他程式：其他模組只需要鍵時引用這裡，不會連帶包含整個模組）。
 */
import { defineResource } from '../ecs/Resource';
import type { NavGrid } from './NavGrid';

/** 導航網格資源：world.setResource(NavGridKey, grid)，或 AIPlugin.navGrid = grid */
export const NavGridKey = defineResource<NavGrid>('NavGrid');
