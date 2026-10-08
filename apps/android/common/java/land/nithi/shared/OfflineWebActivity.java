package land.nithi.shared;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.provider.DocumentsContract;
import android.provider.OpenableColumns;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;

public abstract class OfflineWebActivity extends Activity {
    private static final int CHOOSE_FOLDER = 101;
    private static final int EXPORT_FILE = 102;
    private static final int IMPORT_FILE = 103;

    private WebView webView;
    private SharedPreferences preferences;
    private ValueCallback<Uri[]> importCallback;
    private String pendingExportText;

    protected abstract String folderPreferenceKey();
    protected abstract String fileSuffix();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        preferences = getSharedPreferences("portable_files", MODE_PRIVATE);

        webView = new WebView(this);
        webView.setBackgroundColor(Color.TRANSPARENT);
        webView.setOverScrollMode(WebView.OVER_SCROLL_NEVER);
        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setAllowFileAccess(true);
        webView.getSettings().setAllowContentAccess(true);
        webView.addJavascriptInterface(new AndroidBridge(), "AndroidBridge");
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri.getScheme();
                return !("file".equals(scheme) || "about".equals(scheme));
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (importCallback != null) importCallback.onReceiveValue(null);
                importCallback = callback;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT)
                        .addCategory(Intent.CATEGORY_OPENABLE)
                        .setType("application/json");
                try {
                    startActivityForResult(intent, IMPORT_FILE);
                } catch (ActivityNotFoundException error) {
                    importCallback = null;
                    Toast.makeText(OfflineWebActivity.this, "No file picker is available.", Toast.LENGTH_LONG).show();
                    return false;
                }
                return true;
            }
        });

        setContentView(webView, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));
        webView.loadUrl("file:///android_asset/web/index.html");
    }

    @Override
    protected void onDestroy() {
        if (importCallback != null) importCallback.onReceiveValue(null);
        webView.removeJavascriptInterface("AndroidBridge");
        webView.destroy();
        super.onDestroy();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == IMPORT_FILE) {
            if (importCallback != null) {
                Uri value = resultCode == RESULT_OK && data != null ? data.getData() : null;
                importCallback.onReceiveValue(value == null ? null : new Uri[]{value});
                importCallback = null;
            }
            return;
        }

        if (requestCode == CHOOSE_FOLDER) {
            if (resultCode == RESULT_OK && data != null && data.getData() != null) {
                Uri treeUri = data.getData();
                try {
                    getContentResolver().takePersistableUriPermission(
                            treeUri,
                            Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                    );
                    preferences.edit().putString(folderPreferenceKey(), treeUri.toString()).apply();
                    sendStatus(treeUri);
                } catch (SecurityException error) {
                    sendError("choose", error);
                }
            } else {
                send(event("cancelled"));
            }
            return;
        }

        if (requestCode == EXPORT_FILE) {
            if (resultCode == RESULT_OK && data != null && data.getData() != null && pendingExportText != null) {
                try (OutputStream output = getContentResolver().openOutputStream(data.getData(), "wt")) {
                    if (output == null) throw new IOException("The selected file could not be opened.");
                    output.write(pendingExportText.getBytes(StandardCharsets.UTF_8));
                } catch (IOException error) {
                    sendError("export", error);
                }
            }
            pendingExportText = null;
        }
    }

    private final class AndroidBridge {
        @JavascriptInterface
        public void postDataFolderMessage(String json) {
            runOnUiThread(() -> {
                try {
                    handleFolderMessage(new JSONObject(json));
                } catch (JSONException error) {
                    sendError("message", error);
                }
            });
        }

        @JavascriptInterface
        public void exportFile(String json) {
            runOnUiThread(() -> {
                try {
                    JSONObject payload = new JSONObject(json);
                    pendingExportText = payload.optString("text", "");
                    String filename = sanitizeFilename(payload.optString("filename"), "export.json");
                    Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT)
                            .addCategory(Intent.CATEGORY_OPENABLE)
                            .setType("application/json")
                            .putExtra(Intent.EXTRA_TITLE, filename);
                    startActivityForResult(intent, EXPORT_FILE);
                } catch (JSONException | ActivityNotFoundException error) {
                    pendingExportText = null;
                    sendError("export", error);
                }
            });
        }
    }

    private void handleFolderMessage(JSONObject payload) {
        String action = payload.optString("action");
        switch (action) {
            case "choose":
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE)
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                                | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
                                | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
                startActivityForResult(intent, CHOOSE_FOLDER);
                break;
            case "status": {
                Uri folder = savedFolder();
                if (folder == null) send(unavailableStatus());
                else sendStatus(folder);
                break;
            }
            case "list":
                withFolder(action, this::listFiles);
                break;
            case "write":
                withFolder(action, folder -> writeFile(folder, payload.optString("filename"), payload.optString("text")));
                break;
            case "delete":
                withFolder(action, folder -> deleteFile(folder, payload.optString("filename")));
                break;
            default:
                break;
        }
    }

    private void listFiles(Uri treeUri) throws Exception {
        JSONArray files = new JSONArray();
        List<FileEntry> entries = children(treeUri);
        entries.sort(Comparator.comparing(entry -> entry.name.toLowerCase(Locale.ROOT)));
        for (FileEntry entry : entries) {
            if (entry.name.toLowerCase(Locale.ROOT).endsWith(fileSuffix())) {
                JSONObject file = new JSONObject();
                file.put("filename", entry.name);
                file.put("text", readText(entry.uri));
                files.put(file);
            }
        }
        JSONObject response = event("files");
        response.put("files", files);
        send(response);
    }

    private void writeFile(Uri treeUri, String requestedName, String text) throws Exception {
        String filename = sanitizeFilename(requestedName, "data" + fileSuffix());
        if (!filename.toLowerCase(Locale.ROOT).endsWith(fileSuffix())) {
            throw new IOException("Files must end in " + fileSuffix() + ".");
        }
        Uri fileUri = findChild(treeUri, filename);
        if (fileUri == null) {
            Uri parent = DocumentsContract.buildDocumentUriUsingTree(
                    treeUri,
                    DocumentsContract.getTreeDocumentId(treeUri)
            );
            fileUri = DocumentsContract.createDocument(getContentResolver(), parent, "application/json", filename);
        }
        if (fileUri == null) throw new IOException("The file could not be created.");
        try (OutputStream output = getContentResolver().openOutputStream(fileUri, "wt")) {
            if (output == null) throw new IOException("The file could not be opened.");
            output.write(text.getBytes(StandardCharsets.UTF_8));
        }
        JSONObject response = event("write");
        response.put("filename", filename);
        send(response);
    }

    private void deleteFile(Uri treeUri, String requestedName) throws Exception {
        String filename = sanitizeFilename(requestedName, "");
        if (filename.isEmpty() || !filename.toLowerCase(Locale.ROOT).endsWith(fileSuffix())) return;
        Uri fileUri = findChild(treeUri, filename);
        if (fileUri != null) DocumentsContract.deleteDocument(getContentResolver(), fileUri);
        JSONObject response = event("delete");
        response.put("filename", filename);
        send(response);
    }

    private List<FileEntry> children(Uri treeUri) {
        List<FileEntry> result = new ArrayList<>();
        String treeId = DocumentsContract.getTreeDocumentId(treeUri);
        Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, treeId);
        String[] columns = {DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME};
        try (Cursor cursor = getContentResolver().query(childrenUri, columns, null, null, null)) {
            if (cursor == null) return result;
            while (cursor.moveToNext()) {
                String documentId = cursor.getString(0);
                String name = cursor.getString(1);
                result.add(new FileEntry(name, DocumentsContract.buildDocumentUriUsingTree(treeUri, documentId)));
            }
        }
        return result;
    }

    private Uri findChild(Uri treeUri, String filename) {
        for (FileEntry entry : children(treeUri)) {
            if (entry.name.equalsIgnoreCase(filename)) return entry.uri;
        }
        return null;
    }

    private String readText(Uri uri) throws IOException {
        StringBuilder text = new StringBuilder();
        try (InputStream input = getContentResolver().openInputStream(uri)) {
            if (input == null) throw new IOException("The file could not be opened.");
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(input, StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    if (text.length() > 0) text.append('\n');
                    text.append(line);
                }
            }
        }
        return text.toString();
    }

    private Uri savedFolder() {
        String value = preferences.getString(folderPreferenceKey(), null);
        return value == null ? null : Uri.parse(value);
    }

    private void withFolder(String action, FolderOperation operation) {
        Uri folder = savedFolder();
        if (folder == null) {
            send(unavailableStatus());
            return;
        }
        try {
            operation.run(folder);
        } catch (Exception error) {
            sendError(action, error);
        }
    }

    private void sendStatus(Uri folder) {
        JSONObject response = event("status");
        try {
            response.put("available", true);
            response.put("folderName", displayName(folder));
        } catch (JSONException ignored) {}
        send(response);
    }

    private JSONObject unavailableStatus() {
        JSONObject response = event("status");
        try { response.put("available", false); } catch (JSONException ignored) {}
        return response;
    }

    private String displayName(Uri uri) {
        try (Cursor cursor = getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) return cursor.getString(0);
        } catch (Exception ignored) {}
        String id = DocumentsContract.getTreeDocumentId(uri);
        int separator = id.lastIndexOf(':');
        return separator >= 0 ? id.substring(separator + 1) : id;
    }

    private String sanitizeFilename(String requestedName, String fallback) {
        String value = requestedName == null ? "" : requestedName
                .replaceAll("[^A-Za-z0-9._ -]", "-")
                .trim();
        return value.isEmpty() ? fallback : value;
    }

    private JSONObject event(String name) {
        JSONObject value = new JSONObject();
        try { value.put("event", name); } catch (JSONException ignored) {}
        return value;
    }

    private void sendError(String action, Exception error) {
        JSONObject response = event("error");
        try {
            response.put("action", action);
            response.put("message", error.getLocalizedMessage());
        } catch (JSONException ignored) {}
        send(response);
    }

    private void send(JSONObject payload) {
        String script = "window.nativeFolderStorage?.receive(" + payload + ");";
        webView.post(() -> webView.evaluateJavascript(script, null));
    }

    private interface FolderOperation {
        void run(Uri folder) throws Exception;
    }

    private static final class FileEntry {
        final String name;
        final Uri uri;

        FileEntry(String name, Uri uri) {
            this.name = name;
            this.uri = uri;
        }
    }
}
