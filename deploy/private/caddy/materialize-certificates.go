// MIDAS deterministic local backport materializer. Standard library only.
package main
import("bytes";"crypto/sha256";"encoding/hex";"encoding/json";"fmt";"io/fs";"os";"path/filepath")
type Edit struct {Offset int `json:"offset"`; Old string `json:"old"`; New string `json:"new"`}
type File struct {Path string `json:"path"`; Exists bool `json:"exists"`; Before string `json:"before_sha256"`; After string `json:"after_sha256"`; Edits []Edit `json:"edits"`}
type Manifest struct {Files []File `json:"files"`}
func digest(b []byte)string{s:=sha256.Sum256(b);return hex.EncodeToString(s[:])}
func main(){if len(os.Args)!=3{panic("usage: materializer source-directory manifest.json")};raw,e:=os.ReadFile(os.Args[2]);if e!=nil{panic(e)};var m Manifest;if e=json.Unmarshal(raw,&m);e!=nil{panic(e)};if len(m.Files)==0{panic("empty backport")};out:=map[string][]byte{}
for _,f:=range m.Files{if !fs.ValidPath(f.Path){panic("invalid relative source path")};p:=filepath.Join(os.Args[1],filepath.FromSlash(f.Path));if _,dup:=out[p];dup{panic("duplicate source path")};b,e:=os.ReadFile(p);if f.Exists&&e!=nil{panic(e)};if !f.Exists&&!os.IsNotExist(e){panic("new file already exists")};if digest(b)!=f.Before{panic("source checksum mismatch: "+f.Path)};end:=len(b)+1
for i:=len(f.Edits)-1;i>=0;i--{x:=f.Edits[i];n:=len(x.Old);if x.Offset<0||x.Offset+n>len(b)||x.Offset+n>=end||!bytes.Equal(b[x.Offset:x.Offset+n],[]byte(x.Old)){panic("exact edit mismatch: "+f.Path)};end=x.Offset;b=append(append(append([]byte{},b[:x.Offset]...),[]byte(x.New)...),b[x.Offset+n:]...)}
if digest(b)!=f.After{panic("result checksum mismatch: "+f.Path)};out[p]=b}
// Validate all source/result bytes before changing the owned source copy.
for p,b:=range out{if e=os.MkdirAll(filepath.Dir(p),0755);e!=nil{panic(e)};if _,e=os.Stat(p);e==nil{if e=os.Chmod(p,0644);e!=nil{panic(e)}};if e=os.WriteFile(p,b,0644);e!=nil{panic(e)}};fmt.Printf("Verified and materialized %d hash-bound local backport files\n",len(out))}