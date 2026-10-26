import './styles/fonts.css';
import './styles/app.css';
import './styles/player.css';
import { mount } from 'svelte';
import App from './App.svelte';

const target = document.getElementById('app')!;
target.textContent = '';
mount(App, { target });
