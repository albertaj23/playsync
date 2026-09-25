import { useEffect, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { FlaskConical, Headphones, Home, Radio, Sun, Zap } from 'lucide-react';
import { useShortcut } from '../../lib/keys';
import { PageMetaProvider, SidebarProvider, useSidebar, usePageMetaValue } from '../../lib/shell';
import { useTheme } from '../../lib/theme';
import { CommandSearch, type CommandItem } from '../watermelon/command-search';
import { MoreSheet } from './MoreSheet';
import { AmbientLayer, ScrollChrome } from './ScrollChrome';
import { Sidebar } from './Sidebar';
import { TabBar } from './TabBar';
import { TopBar } from './TopBar';
import { itemFor } from './nav';

function Palette() {
  const navigate = useNavigate();
  const { searchOpen, setSearchOpen } = useSidebar();
  const { toggle } = useTheme();
  const meta = usePageMetaValue();
  const go = (to: string) => () => navigate(to);
  const items: CommandItem[] = [
    ...(meta.commands ?? []).map((c) => ({ id: c.id, title: c.title, section: 'On this page', icon: <Zap size={16} />, action: c.action })),
    { id: 'home', title: 'Home', section: 'Go to', icon: <Home size={16} />, action: go('/') },
    { id: 'devices', title: 'My devices', section: 'Go to', icon: <Headphones size={16} />, action: go('/devices') },
    { id: 'stress', title: 'Stress test', section: 'Go to', icon: <Zap size={16} />, action: go('/stress') },
    { id: 'sim', title: 'Simulation control room', section: 'Go to', icon: <Radio size={16} />, action: go('/sim') },
    { id: 'nerds', title: 'Stats for nerds', section: 'Go to', icon: <FlaskConical size={16} />, action: go('/nerds') },
    { id: 'stepper', title: 'Transaction Stepper', section: 'Nerd tools', icon: <FlaskConical size={16} />, action: go('/nerds?tab=stepper') },
    { id: 'lab', title: 'Concurrency Lab', section: 'Nerd tools', icon: <FlaskConical size={16} />, action: go('/nerds?tab=lab') },
    { id: 'theme', title: 'Switch light / dark', section: 'Handy', icon: <Sun size={16} />, action: toggle },
  ];
  return (
    <div className="fixed left-[calc(50%-160px)] top-20 z-[75] w-0 md:left-[calc(50%-200px)]">
      <CommandSearch items={items} placeholder="Search…" open={searchOpen} onOpenChange={setSearchOpen} hideTrigger />
    </div>
  );
}

function Frame({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const { toggle } = useSidebar();
  useShortcut('mod+b', toggle);
  const item = itemFor(pathname);
  const meta = usePageMetaValue();
  useEffect(() => { document.title = `${meta.title ?? item?.label ?? (pathname === '/device' ? 'This device' : 'PlaySync')} · PlaySync`; }, [meta.title, item, pathname]);
  return (
    <div className="min-h-screen">
      <a href="#main" className="skip-link">Skip to content</a>
      <Sidebar />
      <div className="app-column">
        <TopBar focus={pathname === '/device'} />
        <main id="main" className="mx-auto max-w-6xl px-4 py-8 pb-[calc(var(--tabbar-h)+var(--safe-bottom)+2rem)] sm:px-6">{children}</main>
      </div>
      <TabBar />
      <MoreSheet />
      <Palette />
      <ScrollChrome />
      <AmbientLayer />
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return (
    <PageMetaProvider>
      <SidebarProvider focus={pathname === '/device'}>
        <Frame>{children}</Frame>
      </SidebarProvider>
    </PageMetaProvider>
  );
}

