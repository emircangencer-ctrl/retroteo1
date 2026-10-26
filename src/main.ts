import './styles/fonts.css';
import './styles/app.css';
import './styles/player.css';
import { mount } from 'svelte';
import App from './App.svelte';
import { installTvHost } from './lib/tv-host.ts';

// The TV app (Android TV / Google TV) or ?tv=1: TV layout, remote, controller bridge.
installTvHost();

const target = document.getElementById('app')!;
target.textContent = '';
mount(App, { target });
