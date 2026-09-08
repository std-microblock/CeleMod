package com.celemod.tests;
import android.app.Instrumentation;
import android.content.Context;
import android.os.Bundle;
import org.json.JSONObject;
import java.io.File;
import java.lang.reflect.InvocationTargetException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

public final class SteamVaultCheck extends Instrumentation {
  private Bundle args;
  public void onCreate(Bundle arguments) { super.onCreate(arguments); args=arguments; start(); }
  private static void check(boolean condition) { if(!condition) throw new AssertionError("Vault assertion failed"); }
  public void onStart() {
    Bundle report=new Bundle();
    try {
      Context c=getTargetContext();
      String nonce=args.getString("nonce"), phase=args.getString("phase");
      check(nonce!=null && nonce.matches("[a-z0-9]{12}"));
      File marker=new File(c.getFilesDir(),"steam-vault-test-owner");
      File encrypted=new File(c.getFilesDir(),"steam-account.enc.json");
      String account="fixture_"+nonce, password="fixture-password-"+nonce, token="fixture-token-"+nonce;
      if("clear".equals(phase) && !marker.exists()) {
        report.putString("result","PASS clear"); finish(-1,report); return;
      }
      if("write".equals(phase)) {
        // Never replace real credentials, unfinished writes or pending saves.
        check(!marker.exists() && !encrypted.exists());
        check(!new File(encrypted+".bak").exists() && !new File(encrypted+".new").exists());
        check(!new File(c.getFilesDir(),"steam-pending.json").exists());
      } else check(marker.exists() && nonce.equals(new String(Files.readAllBytes(marker.toPath()),StandardCharsets.UTF_8)));
      Class<?> type=Class.forName("com.celemod.runtime.SteamVault",true,c.getClassLoader());
      Object vault=type.getField("INSTANCE").get(null);
      if("write".equals(phase)) {
        Files.write(marker.toPath(),nonce.getBytes(StandardCharsets.UTF_8));
        type.getMethod("write",Context.class,JSONObject.class).invoke(vault,c,new JSONObject()
          .put("account",account).put("steamId","76561198000000000").put("clientId","0").put("token",token).put("password",password));
        String disk=new String(Files.readAllBytes(encrypted.toPath()),StandardCharsets.UTF_8);
        check(!disk.contains(password) && !disk.contains(token) && !disk.contains(account));
      } else {
        JSONObject saved=(JSONObject)type.getMethod("read",Context.class).invoke(vault,c);
        if("read".equals(phase)) {
          check(saved!=null && account.equals(saved.getString("account")));
          check(password.equals(type.getMethod("passwordFor",Context.class,String.class).invoke(vault,c," "+account.toUpperCase()+" ")));
          boolean rejected=false;
          try {type.getMethod("passwordFor",Context.class,String.class).invoke(vault,c,"different_account");}
          catch(InvocationTargetException e){rejected=e.getCause() instanceof IllegalArgumentException;}
          check(rejected);
          Class<?> bridge=Class.forName("com.celemod.runtime.SteamBridge",true,c.getClassLoader());
          JSONObject status=(JSONObject)bridge.getMethod("status",Context.class).invoke(bridge.getField("INSTANCE").get(null),c);
          check(status.getBoolean("hasSavedPassword") && account.equals(status.getString("account")));
          check(!status.has("password") && !status.has("token") && !status.toString().contains(password) && !status.toString().contains(token));
        } else {
          check("clear".equals(phase));
          check(saved==null || account.equals(saved.getString("account")));
          type.getMethod("clear",Context.class).invoke(vault,c);
          check(type.getMethod("read",Context.class).invoke(vault,c)==null);
          Files.delete(marker.toPath());
        }
      }
      report.putString("result","PASS "+phase); report.putInt("pid",android.os.Process.myPid());
      finish(-1,report);
    } catch(Throwable e) {report.putString("result","FAIL "+e.getClass().getSimpleName());finish(1,report);}
  }
}
