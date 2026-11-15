import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import {
  Assistant_400Regular, Assistant_500Medium, Assistant_600SemiBold, Assistant_700Bold, Assistant_800ExtraBold,
} from '@expo-google-fonts/assistant';
import { SecularOne_400Regular } from '@expo-google-fonts/secular-one';
import * as SplashScreen from 'expo-splash-screen';
import { ThemeProvider, usePalette, useScheme } from './src/components/ui';
import { ToastProvider } from './src/components/Toast';
import { RootNavigator } from './src/navigation/Root';

void SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // The backend polls the sources; the app just needs to stay roughly fresh.
      staleTime: 60_000,
      refetchOnWindowFocus: true,
      retry: 1,
    },
  },
});

/**
 * Everything under the theme: the window behind the screens, and the status
 * bar's icons, follow the app's scheme (the appearance setting), not the phone's.
 */
function ThemedApp(): React.JSX.Element {
  const p = usePalette();
  const scheme = useScheme();

  useEffect(() => {
    // The root view shows through while the keyboard and screen transitions move.
    SystemUI.setBackgroundColorAsync(p.bg).catch(() => undefined);
  }, [p.bg]);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: p.bg }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            {/* `style` names the icons' colour: light icons on the dark palette. */}
            <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
            <RootNavigator />
          </ToastProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

export default function App(): React.JSX.Element | null {
  const [fontsLoaded, fontError] = useFonts({
    Assistant_400Regular, Assistant_500Medium, Assistant_600SemiBold, Assistant_700Bold, Assistant_800ExtraBold,
    SecularOne_400Regular,
  });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // A missing font must not hold the app hostage — render with the fallback.
    if (fontsLoaded || fontError) {
      setReady(true);
      void SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!ready) return null;

  return (
    <ThemeProvider>
      <ThemedApp />
    </ThemeProvider>
  );
}
