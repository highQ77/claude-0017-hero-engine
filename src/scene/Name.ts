import { defineComponent } from '../ecs/Component';

/** 實體名稱：場景檔、編輯器的階層面板顯示用；也可以搭配 scripts.find('Player') 或 Script.find() 找實體 */
export const Name = defineComponent<{ value: string }>('Name', () => ({ value: '' }));
