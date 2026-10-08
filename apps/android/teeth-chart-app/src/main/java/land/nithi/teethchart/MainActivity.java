package land.nithi.teethchart;

import land.nithi.shared.OfflineWebActivity;

public final class MainActivity extends OfflineWebActivity {
    @Override protected String folderPreferenceKey() { return "TeethChartApp.dataFolder.v1"; }
    @Override protected String fileSuffix() { return ".json"; }
}
