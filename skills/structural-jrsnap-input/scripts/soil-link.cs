// Link a .sdc to an .ndu with JRSNAP_Input 5.2-L03's own code (mdlRenkei), without its dialog:
// the steps of frmSoilRenkei.cmdOK_Click after SetGlobal_SoilRenkei, the link's settings read from the .ndu's
// SRenkeiNum / SoilRenkeiFile1 / SoilRenkeiInfo1. Based on roundtrip.cs; see references/soil-link.md.
// A 4th argument (comma-separated type names, e.g. mdlRenkei,mdlGlobal) lists their static fields and methods instead.
using System;
using System.IO;
using System.Reflection;
using System.Runtime.Serialization;
using System.Windows.Forms;

[assembly: AssemblyVersion("5.2.3.1")]

internal static class Link
{
    static Assembly asm;
    static Type T(string name) { return asm.GetType("DataInputTool." + name, true); }
    const BindingFlags ALL = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static;
    static object Get(string type, string field) { return T(type).GetField(field, ALL).GetValue(null); }
    static void Set(string type, string field, object value) { T(type).GetField(field, ALL).SetValue(null, value); }
    static object[] Call(string type, string method, params object[] args)
    {
        MethodInfo m = T(type).GetMethod(method, BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static);
        if (m == null) throw new MissingMethodException(type, method);
        object r = m.Invoke(null, args);
        Console.WriteLine(type + "." + method + " -> " + (r == null ? "void" : r.ToString()));
        return args;
    }

    static void Watch()
    {
        int me = System.Diagnostics.Process.GetCurrentProcess().Id;
        while (true)
        {
            System.Threading.Thread.Sleep(500);
            foreach (var w in JrsnapDialogAutomation.TopLevelWindows(me))
            {
                if (!w.Visible || w.ClassName != "#32770") continue;
                var kids = JrsnapDialogAutomation.ChildWindows(w.Handle);
                var text = string.Join(" | ", Array.ConvertAll(kids, k => k.ClassName + ":" + k.Title));
                // a user keeping the model as written: no re-division, no renumbering; link despite warnings
                string want = text.Contains("1Dで分割") || text.Contains("非線形番号を自動設定") || text.Contains("任意番号")
                              ? "いいえ" : text.Contains("節点を追加") ? "キャンセル" : text.Contains("連携しますか") ? "はい" : "OK";
                JrsnapDialogAutomation.WindowInfo pick = null;
                foreach (var k in kids) if (k.ClassName == "Button" && k.Title.StartsWith(want)) pick = k;
                if (pick == null) foreach (var k in kids) if (k.ClassName == "Button" && k.Title.StartsWith("OK")) pick = k;
                Console.WriteLine("DIALOG [" + w.Title + "] " + text + " -> " + (pick == null ? "none" : pick.Title));
                Console.Out.Flush();
                if (pick != null) JrsnapDialogAutomation.ClickDialogButton(w.Handle, pick.Handle);
            }
        }
    }

    [STAThread]
    static int Main(string[] args)
    {
        var watcher = new System.Threading.Thread(Watch);
        watcher.IsBackground = true;
        watcher.Start();
        try
        {
            string exe = Path.GetFullPath(args[0]), input = Path.GetFullPath(args[1]), output = Path.GetFullPath(args[2]);
            Directory.SetCurrentDirectory(Path.GetDirectoryName(output));
            AppDomain.CurrentDomain.AssemblyResolve += delegate(object s, ResolveEventArgs e)
            {
                string dep = Path.Combine(Path.GetDirectoryName(exe), new AssemblyName(e.Name).Name + ".dll");
                return File.Exists(dep) ? Assembly.LoadFrom(dep) : null;
            };
            asm = Assembly.LoadFrom(exe);
            if (args.Length > 3)
            {
                foreach (string name in args[3].Split(','))
                {
                    Type t = asm.GetType("DataInputTool." + name, false);
                    if (t == null) { Console.WriteLine(name + ": none"); continue; }
                    foreach (FieldInfo f in t.GetFields(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static))
                        Console.WriteLine(name + " F " + f.Name + " : " + f.FieldType.Name);
                    foreach (MethodInfo m in t.GetMethods(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static | BindingFlags.DeclaredOnly))
                        Console.WriteLine(name + " M " + m.Name + "(" + string.Join(",", Array.ConvertAll(m.GetParameters(), x => x.ParameterType.Name)) + ")");
                }
                return 0;
            }
            Type global2 = T("mdlGlobal2");
            global2.GetField("G_intSNAP_FLG").SetValue(null, (short)1);
            short[] flags = (short[])global2.GetField("G_intViewFlg").GetValue(null);
            short[] values = { 1, 0, 1, 1, 1, 2, 2, 1, 1, 1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 0, 1, 1, 1, 1, 0, 1, 0 };
            Array.Copy(values, flags, values.Length);
            global2.GetField("G_blnVerKanri").SetValue(null, true);
            Type formType = T("frmMain");
            Form form = (Form)FormatterServices.GetUninitializedObject(formType);
            formType.GetField("_mnuOTFLink", BindingFlags.Instance | BindingFlags.NonPublic).SetValue(form, new ToolStripMenuItem());
            T("mdlGlobal").GetField("G_MainFrm").SetValue(null, form);
            Call("mdlInitData", "mdl_SystemInitialize");
            object[] read = Call("mdlDataFile", "mdl_Get_NDUDataFile", input);

            short renkei = 1;
            string file = ((string[])Get("mdlGlobal", "G_SOIL_RENKEIFILE"))[renkei];
            short[] kuiHoko = (short[])Get("mdlGlobal", "G_KuiHoko");
            short[] kajyu = (short[])Get("mdlGlobal", "G_KajyuHoko");
            short[] opt = (short[])Get("mdlGlobal", "G_optBane");
            short[] bane = (short[])Get("mdlGlobal", "G_BaneKind");
            short[,] tekiyo = (short[,])Get("mdlGlobal", "G_STekiyoKUI");
            Console.WriteLine("link: " + file + " hoko=" + kuiHoko[renkei] + " kajyu=" + kajyu[renkei] + " opt=" + opt[renkei]
                              + " bane=" + bane[renkei] + " piles=" + tekiyo[renkei, 1] + "-" + tekiyo[renkei, 2]);
            Set("mdlRenkei", "RenkeiNo", renkei);
            Set("mdlRenkei", "SDC_FILE_NAME", file);

            object[] a = Call("mdlRenkei", "SOILData_Read", file, (short)0);
            if ((short)a[1] != 0) throw new Exception("SOILData_Read " + a[1]);
            a = Call("mdlRenkei", "KuiCount", (short)0);
            if ((short)a[0] != 0) throw new Exception("KuiCount " + a[0]);
            a = Call("mdlRenkei", "RenkeiDataCheck", kuiHoko[renkei], (short)1);
            Set("mdlRenkei", "KuiHoko", (short)(kuiHoko[renkei] - 1));

            // cmdOK_Click after SetGlobal_SoilRenkei
            a = Call("mdlRenkei", "SOILData_Read", file, (short)0);
            if ((short)a[1] != 0) throw new Exception("SOILData_Read(2) " + a[1]);
            if (opt[renkei] == 1) Call("mdlRenkei", "Calc_Bane");
            if (opt[renkei] == 0)
            {
                a = Call("mdlRenkei", "SetOkuyuki", (short)0);
                short ir = (short)a[0];
                if (ir == 1 || (ir == 0 && kajyu[renkei] == 1)) Call("mdlRenkei", "Calc_Bane2");
                else if (ir == 8) throw new Exception("SetOkuyuki 8");
            }
            Call("mdlRenkei", "Calc_Bane3");
            Type g = T("mdlGlobal");
            object[] ji = { g.GetField("G_intJointNum").GetValue(null), g.GetField("G_intElementNum").GetValue(null),
                            g.GetField("G_sngJointXY").GetValue(null), g.GetField("G_intElementInfo").GetValue(null) };
            T("mdlOptNo").GetMethod("変更前JointInfo").Invoke(null, ji);
            object[] gj = Call("mdlRenkei", "GET_JOINT_DATA", (short)0, new double[2501]);
            ji = new object[] { g.GetField("G_intJointNum").GetValue(null), g.GetField("G_intElementNum").GetValue(null),
                                g.GetField("G_sngJointXY").GetValue(null), g.GetField("G_intElementInfo").GetValue(null) };
            T("mdlOptNo").GetMethod("変更後JointInfo").Invoke(null, ji);
            g.GetField("G_intJointNum").SetValue(null, ji[0]);
            g.GetField("G_intElementNum").SetValue(null, ji[1]);
            g.GetField("G_sngJointXY").SetValue(null, ji[2]);
            g.GetField("G_intElementInfo").SetValue(null, ji[3]);
            Call("mdlRenkei", "SetTisou");
            short kg = (short)Get("mdlGlobal", "G_intKGNum");
            short[,] kgInfo = (short[,])Get("mdlGlobal", "G_intKGInfo");
            double[] betaL = (double[])Get("mdlGlobal2", "S_BetaL");
            Array kgSng = (Array)Get("mdlGlobal", "G_sngKGInfo");
            for (int i = 1; i <= kg; i++)
                if (kgInfo[i, 1] >= tekiyo[renkei, 1] && kgInfo[i, 1] <= tekiyo[renkei, 2])
                    kgSng.SetValue(Convert.ChangeType(betaL[kuiHoko[renkei]], kgSng.GetType().GetElementType()), i);

            object[] w = Call("mdlDataFile", "mdl_Wrt_NDUDataFile", output);
            return File.Exists(output) ? 0 : 2;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error);
            return 1;
        }
    }
}
