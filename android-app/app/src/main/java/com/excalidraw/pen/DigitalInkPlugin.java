package com.excalidraw.pen;

import android.content.res.AssetManager;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.mlkit.common.model.DownloadConditions;
import com.google.mlkit.common.model.RemoteModelManager;
import com.google.mlkit.vision.digitalink.DigitalInkRecognition;
import com.google.mlkit.vision.digitalink.DigitalInkRecognitionModel;
import com.google.mlkit.vision.digitalink.DigitalInkRecognitionModelIdentifier;
import com.google.mlkit.vision.digitalink.DigitalInkRecognizer;
import com.google.mlkit.vision.digitalink.DigitalInkRecognizerOptions;
import com.google.mlkit.vision.digitalink.Ink;
import com.google.mlkit.vision.digitalink.RecognitionCandidate;
import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

@CapacitorPlugin(name = "DigitalInk")
public class DigitalInkPlugin extends Plugin {

    private DigitalInkRecognitionModelIdentifier getModelIdentifier(String languageTag) {
        try {
            return DigitalInkRecognitionModelIdentifier.fromLanguageTag(languageTag);
        } catch (Exception e) {
            return null;
        }
    }

    @PluginMethod
    public void checkAvailability(PluginCall call) {
        String languageTag = call.getString("languageTag", "en-US");
        DigitalInkRecognitionModelIdentifier modelId = getModelIdentifier(languageTag);

        if (modelId == null) {
            JSObject ret = new JSObject();
            ret.put("available", false);
            ret.put("downloaded", false);
            call.resolve(ret);
            return;
        }

        tryUnpackBundledAssets(languageTag);

        DigitalInkRecognitionModel model = DigitalInkRecognitionModel.builder(modelId).build();
        RemoteModelManager.getInstance().isModelDownloaded(model)
            .addOnSuccessListener(isDownloaded -> {
                JSObject ret = new JSObject();
                ret.put("available", true);
                ret.put("downloaded", isDownloaded);
                call.resolve(ret);
            })
            .addOnFailureListener(e -> {
                JSObject ret = new JSObject();
                ret.put("available", false);
                ret.put("downloaded", false);
                call.resolve(ret);
            });
    }

    @PluginMethod
    public void downloadModel(PluginCall call) {
        String languageTag = call.getString("languageTag", "en-US");
        DigitalInkRecognitionModelIdentifier modelId = getModelIdentifier(languageTag);

        if (modelId == null) {
            call.reject("Unsupported language tag: " + languageTag);
            return;
        }

        DigitalInkRecognitionModel model = DigitalInkRecognitionModel.builder(modelId).build();
        DownloadConditions conditions = new DownloadConditions.Builder().build();

        RemoteModelManager.getInstance().download(model, conditions)
            .addOnSuccessListener(unused -> {
                JSObject ret = new JSObject();
                ret.put("success", true);
                call.resolve(ret);
            })
            .addOnFailureListener(e -> call.reject("Failed to download model: " + e.getMessage(), e));
    }

    @PluginMethod
    public void recognize(PluginCall call) {
        String languageTag = call.getString("languageTag", "en-US");
        JSArray strokesArray = call.getArray("strokes");

        if (strokesArray == null || strokesArray.length() == 0) {
            JSObject ret = new JSObject();
            ret.put("candidates", new JSArray());
            call.resolve(ret);
            return;
        }

        DigitalInkRecognitionModelIdentifier modelId = getModelIdentifier(languageTag);

        if (modelId == null) {
            call.reject("Unsupported language tag: " + languageTag);
            return;
        }

        tryUnpackBundledAssets(languageTag);

        DigitalInkRecognitionModel model = DigitalInkRecognitionModel.builder(modelId).build();
        RemoteModelManager remoteModelManager = RemoteModelManager.getInstance();

        remoteModelManager.isModelDownloaded(model)
            .addOnSuccessListener(isDownloaded -> {
                if (isDownloaded) {
                    performRecognition(call, model, strokesArray);
                } else {
                    // Attempt download if not already cached
                    DownloadConditions conditions = new DownloadConditions.Builder().build();
                    remoteModelManager.download(model, conditions)
                        .addOnSuccessListener(unused -> performRecognition(call, model, strokesArray))
                        .addOnFailureListener(e -> call.reject(
                            "Model for " + languageTag + " is not downloaded. Please connect to internet to download once.",
                            e
                        ));
                }
            })
            .addOnFailureListener(e -> call.reject("Failed checking model availability: " + e.getMessage(), e));
    }

    private void performRecognition(PluginCall call, DigitalInkRecognitionModel model, JSArray strokesArray) {
        try {
            Ink.Builder inkBuilder = Ink.builder();

            for (int i = 0; i < strokesArray.length(); i++) {
                JSONObject strokeObj = strokesArray.getJSONObject(i);
                JSONArray pointsArray = strokeObj.optJSONArray("points");
                if (pointsArray == null || pointsArray.length() == 0) {
                    continue;
                }

                Ink.Stroke.Builder strokeBuilder = Ink.Stroke.builder();
                for (int j = 0; j < pointsArray.length(); j++) {
                    JSONObject pt = pointsArray.getJSONObject(j);
                    float x = (float) pt.getDouble("x");
                    float y = (float) pt.getDouble("y");
                    long t = pt.has("t") ? pt.getLong("t") : (j * 16L);
                    strokeBuilder.addPoint(Ink.Point.create(x, y, t));
                }
                inkBuilder.addStroke(strokeBuilder.build());
            }

            Ink ink = inkBuilder.build();
            DigitalInkRecognizer recognizer = DigitalInkRecognition.getClient(
                DigitalInkRecognizerOptions.builder(model).build()
            );

            recognizer.recognize(ink)
                .addOnSuccessListener(result -> {
                    JSArray candidates = new JSArray();
                    for (RecognitionCandidate candidate : result.getCandidates()) {
                        candidates.put(candidate.getText());
                    }
                    JSObject ret = new JSObject();
                    ret.put("candidates", candidates);
                    call.resolve(ret);
                    recognizer.close();
                })
                .addOnFailureListener(e -> {
                    call.reject("Recognition failed: " + e.getMessage(), e);
                    recognizer.close();
                });
        } catch (Exception e) {
            call.reject("Error parsing ink strokes: " + e.getMessage(), e);
        }
    }

    private void tryUnpackBundledAssets(String languageTag) {
        try {
            AssetManager am = getContext().getAssets();
            String assetSubdir = "mlkit-models/" + languageTag;
            String[] list = am.list(assetSubdir);
            if (list != null && list.length > 0) {
                File targetDir = new File(getContext().getFilesDir(), "mlkit_digital_ink_recognition/" + languageTag);
                if (!targetDir.exists()) {
                    targetDir.mkdirs();
                    for (String fileName : list) {
                        try (InputStream in = am.open(assetSubdir + "/" + fileName);
                             OutputStream out = new FileOutputStream(new File(targetDir, fileName))) {
                            byte[] buffer = new byte[8192];
                            int read;
                            while ((read = in.read(buffer)) != -1) {
                                out.write(buffer, 0, read);
                            }
                        }
                    }
                }
            }
        } catch (Exception ignored) {
            // Silently fall back to standard RemoteModelManager cache
        }
    }
}
