import type { Theme } from 'vitepress';
import DefaultTheme from 'vitepress/theme';
import NeoDiagram from './components/NeoDiagram.vue';
import './custom.css';

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('NeoDiagram', NeoDiagram);
  },
} satisfies Theme;
