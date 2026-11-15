import { registerRootComponent } from 'expo';
// tweetnacl's random source on the phone (friends' secrets and keys), before anything can make one.
import './src/buddies/random';

import { forceRtl } from './src/lib/rtl';
import { applyStoredSchoolCalendar } from './src/local/schoolCalendar';
import { storage } from './src/widget/feedCache';
import { registerWidgets } from './src/widget/register';
// Defines the background refresh task: Android may start the JS just to run it.
import './src/background/refresh';
import App from './App';

// Before anything React touches: the first render must already be RTL.
forceRtl();
// Before any day is built, here, in a widget or in the background: the Ministry's vacations as last read.
applyStoredSchoolCalendar(storage);

// Android and iOS: `register.ts` is a no-op elsewhere.
registerWidgets();
registerRootComponent(App);
