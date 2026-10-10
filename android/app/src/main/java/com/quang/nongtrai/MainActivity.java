package com.quang.nongtrai;

import android.os.Bundle;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        WebView web = getBridge().getWebView();
        // The game's audio is unlocked by interaction anyway, but ambient music
        // that starts on its own after a battle or a buff should not be gated on
        // a tap the player never needed to make on the web version.
        web.getSettings().setMediaPlaybackRequiresUserGesture(false);
        // Saves live in localStorage — make sure the WebView keeps them.
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setDatabaseEnabled(true);
    }

    /*
     * Hardware back: walk the WebView's own history first (deep links, sheets
     * that pushed a URL), otherwise hand back to the system so the app exits
     * the way a player expects.
     */
    @Override
    public void onBackPressed() {
        WebView web = getBridge().getWebView();
        if (web != null && web.canGoBack()) {
            web.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
