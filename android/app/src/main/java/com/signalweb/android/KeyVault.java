package com.signalweb.android;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

final class KeyVault {
    private static final String ALIAS = "signalweb.deepseek.api_key.v1";
    private static final String PREFS = "signalweb.secure";
    private final Context context;

    KeyVault(Context context) {
        this.context = context.getApplicationContext();
    }

    private SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(ALIAS)) {
            return (SecretKey) store.getKey(ALIAS, null);
        }
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build());
        return generator.generateKey();
    }

    void save(String value) throws Exception { saveNamed("deepseek", value); }

    void saveNamed(String name, String value) throws Exception {
        name = name.matches("[a-z0-9_-]+") ? name : null;
        if (name == null) throw new IllegalArgumentException("未知密钥名称");
        if (value == null || value.trim().isEmpty()) throw new IllegalArgumentException("API Key 不能为空");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key());
        byte[] encrypted = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
        SharedPreferences.Editor edit = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit();
        String prefix = "deepseek".equals(name) ? "" : name + ".";
        edit.putString(prefix + "iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP));
        edit.putString(prefix + "ciphertext", Base64.encodeToString(encrypted, Base64.NO_WRAP));
        if (!edit.commit()) throw new IllegalStateException("保存 API Key 失败");
    }

    String read() throws Exception { return readNamed("deepseek"); }

    String readNamed(String name) throws Exception {
        name = name.matches("[a-z0-9_-]+") ? name : null;
        if (name == null) throw new IllegalArgumentException("未知密钥名称");
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String prefix = "deepseek".equals(name) ? "" : name + ".";
        String iv = prefs.getString(prefix + "iv", null);
        String encrypted = prefs.getString(prefix + "ciphertext", null);
        if (iv == null && encrypted == null) return null;
        if (iv == null || encrypted == null) throw new IllegalStateException("API Key 保存内容不完整");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(),
                new GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)));
        return new String(cipher.doFinal(Base64.decode(encrypted, Base64.NO_WRAP)),
                StandardCharsets.UTF_8);
    }
}
