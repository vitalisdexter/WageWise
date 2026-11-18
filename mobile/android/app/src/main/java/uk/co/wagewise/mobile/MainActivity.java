package uk.co.wagewise.mobile;

import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private boolean keyboardVisible;

    @Override
    public void onCreate(Bundle state) {
        registerPlugin(WageWisePlugin.class);
        super.onCreate(state);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView()).setAppearanceLightStatusBars(false);
        WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView()).setAppearanceLightNavigationBars(false);
        View content = findViewById(android.R.id.content);
        content.setBackgroundColor(Color.rgb(23, 58, 47));
        ViewCompat.setOnApplyWindowInsetsListener(content, (view, insets) -> {
            int bars = WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout();
            int ime = WindowInsetsCompat.Type.ime();
            Insets safeArea = insets.getInsets(bars);
            boolean editing = insets.isVisible(ime) && insets.getInsets(ime).bottom > 0;
            int bottom = editing ? Math.max(safeArea.bottom, insets.getInsets(ime).bottom) : safeArea.bottom;
            view.setPadding(safeArea.left, safeArea.top, safeArea.right, bottom);
            if (keyboardVisible != editing) {
                keyboardVisible = editing;
                getBridge().getWebView().evaluateJavascript(
                    "document.documentElement.classList.toggle('ime-open', " + editing + ");", null);
            }
            // This container already reserves the keyboard and system bar areas.
            // Send zero insets to WebView so its visual viewport does not shrink twice.
            return new WindowInsetsCompat.Builder(insets)
                .setInsets(bars | ime, Insets.NONE)
                .setVisible(ime, false)
                .build();
        });
        ViewCompat.requestApplyInsets(content);
    }
}
